import { randomUUID } from "node:crypto";
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { checkUpload, normalizePhoto, PHOTO_MAX_BYTES, previewPathOf, previewPhoto, renderForViewer, watermarkText } from "./photo-image";
import { PhotoLinks } from "./photo-links";

const BUCKET = "member-photos";

/** Une seule réserve de liens pour toute l'API (les deux contrôleurs la partagent). */
export const photoLinks = new PhotoLinks();

type UploadedPhoto = { buffer: Buffer; mimetype: string; size: number };
type ViewRow = { storage_path: string; blurred: boolean; viewer_first_name: string | null; viewer_last_name: string | null; viewer_number: string | null };

/**
 * Photos des membres (section 10.2, question 10 de la phase 3). Tout se fait avec le jeton de la
 * personne (RLS de la base et du stockage) ; la clé service role n'est jamais utilisée ici.
 */
@ApiTags("Photos")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("photos")
export class PhotosController {
  private readonly logger = new Logger(PhotosController.name);

  constructor(private readonly supabase: SupabaseService) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Déposer une photo (JPEG, PNG ou WebP, 8 Mo) : réduite, sans métadonnées, en relecture" })
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }))
  async upload(@CurrentMember() member: AuthenticatedMember, @UploadedFile() file: UploadedPhoto | undefined) {
    const stored = await this.store(member, file, `${randomUUID()}.jpg`, (path) => ["add_photo", { p_path: path }]);
    await this.storePreview(member, stored.id, stored.path, stored.image);
    return { id: stored.id };
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Retirer une de ses photos" })
  async remove(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.supabase.forMember(member.accessToken);
    const path = unwrap(await db.rpc("remove_photo", { p_photo: id })) as string;
    await db.storage.from(BUCKET).remove([path, previewPathOf(path)]);
  }

  @Post("evening/:eventId/:id/link")
  @ApiOperation({ summary: "Lien de 5 minutes vers la copie très floutée d'un participant d'une soirée (aperçu avant de réserver)" })
  async eveningLink(
    @CurrentMember() member: AuthenticatedMember,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const db = this.supabase.forMember(member.accessToken);
    const [view] = unwrap(await db.rpc("evening_preview_for_view", { p_event: eventId, p_photo: id })) as Omit<ViewRow, "blurred">[];
    if (!view) throw new NotFoundException("not_found");
    return this.renderLink(db, { ...view, blurred: true });
  }

  @Post(":id/link")
  @ApiOperation({ summary: "Lien de 5 minutes vers la photo filigranée au nom de la personne qui regarde" })
  async link(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    return this.viewLink(member, "photo_for_view", id);
  }

  // -------------------------------------------------------------------
  // Photos de l'union (espace souvenir, question 1 de la phase 4) : mêmes protections, 3 par
  // membre, relues par l'équipe ; fichier dans le dossier du membre (effacé avec son compte).
  // -------------------------------------------------------------------
  @Post("union/:coupleId")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Déposer une photo de l'union dans l'espace souvenir (JPEG, PNG ou WebP, 8 Mo)" })
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }))
  async uploadUnion(
    @CurrentMember() member: AuthenticatedMember,
    @Param("coupleId", ParseUUIDPipe) coupleId: string,
    @UploadedFile() file: UploadedPhoto | undefined,
  ) {
    const stored = await this.store(member, file, `union-${randomUUID()}.jpg`, (path) => ["add_union_photo", { p_couple: coupleId, p_path: path }]);
    return { id: stored.id };
  }

  @Delete("union/:id")
  @HttpCode(204)
  @ApiOperation({ summary: "Retirer une de ses photos de l'union" })
  async removeUnion(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.supabase.forMember(member.accessToken);
    const path = unwrap(await db.rpc("remove_union_photo", { p_photo: id })) as string;
    await db.storage.from(BUCKET).remove([path]);
  }

  @Post("union/:id/link")
  @ApiOperation({ summary: "Lien de 5 minutes vers une photo de l'union, filigranée au nom de la personne qui regarde" })
  async unionLink(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    return this.viewLink(member, "union_photo_for_view", id);
  }

  /** Réduit l'image, la dépose dans le dossier du membre puis l'enregistre ; fichier retiré si la base refuse. */
  private async store(
    member: AuthenticatedMember,
    file: UploadedPhoto | undefined,
    name: string,
    register: (path: string) => [string, Record<string, string>],
  ) {
    const refusal = checkUpload(file);
    if (refusal) throw new UnprocessableEntityException(refusal);
    let image: Buffer;
    try {
      image = await normalizePhoto(file!.buffer);
    } catch {
      throw new UnprocessableEntityException("photo_unreadable");
    }
    const db = this.supabase.forMember(member.accessToken);
    const path = `${member.id}/${name}`;
    const stored = await db.storage.from(BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
    if (stored.error) throw new UnprocessableEntityException("photo_storage");
    const [fn, args] = register(path);
    const result = await db.rpc(fn, args);
    if (result.error) await db.storage.from(BUCKET).remove([path]);
    return { id: unwrap(result) as string, path, image };
  }

  /**
   * Copie très floutée pour l'aperçu des soirées, déposée avec le jeton du membre. Un échec
   * n'empêche pas le dépôt de la photo : la tâche de copie des aperçus la reprend.
   */
  private async storePreview(member: AuthenticatedMember, photoId: string, path: string, image: Buffer) {
    try {
      const db = this.supabase.forMember(member.accessToken);
      const previewPath = previewPathOf(path);
      const stored = await db.storage.from(BUCKET).upload(previewPath, await previewPhoto(image), { contentType: "image/jpeg", upsert: true });
      if (stored.error) throw new Error(stored.error.message);
      unwrap(await db.rpc("set_photo_preview", { p_photo: photoId, p_path: previewPath }));
    } catch (e) {
      this.logger.error(`Copie d'aperçu de la photo ${photoId} : ${(e as Error).message}`);
    }
  }

  /** Image filigranée pour la personne qui regarde, servie par un lien de 5 minutes. */
  private async viewLink(member: AuthenticatedMember, fn: "photo_for_view" | "union_photo_for_view", id: string) {
    const db = this.supabase.forMember(member.accessToken);
    const [view] = unwrap(await db.rpc(fn, { p_photo: id })) as ViewRow[];
    if (!view) throw new NotFoundException("not_found");
    return this.renderLink(db, view);
  }

  /** Télécharge le fichier avec le jeton du membre (RLS du stockage), puis rend l'image filigranée. */
  private async renderLink(db: ReturnType<SupabaseService["forMember"]>, view: ViewRow) {
    const file = await db.storage.from(BUCKET).download(view.storage_path);
    if (file.error || !file.data) throw new NotFoundException("not_found");
    const image = await renderForViewer(Buffer.from(await file.data.arrayBuffer()), {
      blurred: view.blurred,
      watermark: watermarkText({ firstName: view.viewer_first_name, lastName: view.viewer_last_name, number: view.viewer_number }, new Date()),
    });
    const { token, expiresAt } = photoLinks.create(image);
    // Chemin relatif à l'adresse de l'API (NEXT_PUBLIC_API_URL, qui finit par /api)
    return { path: `/photos/view/${token}`, expires_at: expiresAt.toISOString() };
  }
}

/** Affichage par le lien de 5 minutes (balise image du site : pas d'en-tête d'authentification). */
@ApiTags("Photos")
@Controller("photos/view")
export class PhotoViewController {
  @Get(":token")
  @Header("Content-Type", "image/jpeg")
  @Header("Cache-Control", "no-store, private")
  @Header("Content-Disposition", "inline")
  @Header("X-Content-Type-Options", "nosniff")
  @ApiOperation({ summary: "Photo filigranée (lien valable 5 minutes)" })
  view(@Param("token") token: string) {
    const image = photoLinks.get(token);
    if (!image) throw new NotFoundException("expired");
    return new StreamableFile(image);
  }
}
