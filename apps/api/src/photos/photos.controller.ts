import { randomUUID } from "node:crypto";
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
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
import { checkUpload, normalizePhoto, PHOTO_MAX_BYTES, renderForViewer, watermarkText } from "./photo-image";
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
  constructor(private readonly supabase: SupabaseService) {}

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Déposer une photo (JPEG, PNG ou WebP, 8 Mo) : réduite, sans métadonnées, en relecture" })
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }))
  async upload(@CurrentMember() member: AuthenticatedMember, @UploadedFile() file: UploadedPhoto | undefined) {
    const refusal = checkUpload(file);
    if (refusal) throw new UnprocessableEntityException(refusal);
    let image: Buffer;
    try {
      image = await normalizePhoto(file!.buffer);
    } catch {
      throw new UnprocessableEntityException("photo_unreadable");
    }
    const db = this.supabase.forMember(member.accessToken);
    const path = `${member.id}/${randomUUID()}.jpg`;
    const stored = await db.storage.from(BUCKET).upload(path, image, { contentType: "image/jpeg", upsert: false });
    if (stored.error) throw new UnprocessableEntityException("photo_storage");
    const result = await db.rpc("add_photo", { p_path: path });
    if (result.error) await db.storage.from(BUCKET).remove([path]);
    return { id: unwrap(result) as string };
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Retirer une de ses photos" })
  async remove(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.supabase.forMember(member.accessToken);
    const path = unwrap(await db.rpc("remove_photo", { p_photo: id })) as string;
    await db.storage.from(BUCKET).remove([path]);
  }

  @Post(":id/link")
  @ApiOperation({ summary: "Lien de 5 minutes vers la photo filigranée au nom de la personne qui regarde" })
  async link(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string) {
    const db = this.supabase.forMember(member.accessToken);
    const [view] = unwrap(await db.rpc("photo_for_view", { p_photo: id })) as ViewRow[];
    if (!view) throw new NotFoundException("not_found");
    const file = await db.storage.from(BUCKET).download(view.storage_path);
    if (file.error || !file.data) throw new NotFoundException("not_found");
    const image = await renderForViewer(Buffer.from(await file.data.arrayBuffer()), {
      blurred: view.blurred,
      watermark: watermarkText({ firstName: view.viewer_first_name, lastName: view.viewer_last_name, number: view.viewer_number }, new Date()),
    });
    const { token, expiresAt } = photoLinks.create(image);
    return { path: `/api/photos/view/${token}`, expires_at: expiresAt.toISOString() };
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
