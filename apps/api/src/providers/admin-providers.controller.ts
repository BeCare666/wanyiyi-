import {
  Controller,
  ForbiddenException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { type AuthenticatedMember, CurrentMember, MemberGuard } from "../auth/member.guard";
import type { Env } from "../config/env";
import { checkUpload, normalizePhoto, PHOTO_MAX_BYTES } from "../photos/photo-image";
import { unwrap } from "../supabase/db-errors";
import { SupabaseService } from "../supabase/supabase.service";
import { CloudinaryClient } from "./cloudinary";

type UploadedImage = { buffer: Buffer; mimetype: string; size: number };

/**
 * Image d'un prestataire (phase 4, question 2 c) : réduite et sans métadonnées comme les photos,
 * envoyée sur Cloudinary (contenu public de la vitrine), puis enregistrée par
 * app.admin_set_provider_image avec le jeton de la personne (permission providers.manage,
 * vérifiée avant l'envoi). L'ancienne image est ensuite effacée de Cloudinary.
 */
@ApiTags("Administration des prestataires")
@ApiBearerAuth()
@UseGuards(MemberGuard)
@Controller("admin/providers")
export class AdminProvidersController {
  private readonly logger = new Logger(AdminProvidersController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private cloudinary(): CloudinaryClient {
    const cloudName = this.config.get("CLOUDINARY_CLOUD_NAME", { infer: true });
    const apiKey = this.config.get("CLOUDINARY_API_KEY", { infer: true });
    const apiSecret = this.config.get("CLOUDINARY_API_SECRET", { infer: true });
    if (!cloudName || !apiKey || !apiSecret) throw new ServiceUnavailableException("unavailable");
    return new CloudinaryClient({ cloudName, apiKey, apiSecret });
  }

  @Post(":id/image")
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Image d'un prestataire (JPEG, PNG ou WebP, 8 Mo) envoyée sur Cloudinary" })
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } }))
  async image(@CurrentMember() member: AuthenticatedMember, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() file: UploadedImage | undefined) {
    const db = this.supabase.forMember(member.accessToken);
    if (unwrap(await db.rpc("has_permission", { p_permission: "providers.manage" })) !== true) throw new ForbiddenException("forbidden");
    const refusal = checkUpload(file);
    if (refusal) throw new UnprocessableEntityException(refusal);
    let image: Buffer;
    try {
      image = await normalizePhoto(file!.buffer);
    } catch {
      throw new UnprocessableEntityException("photo_unreadable");
    }
    const cloudinary = this.cloudinary();
    const uploaded = await cloudinary.upload(image).catch((e: Error) => {
      this.logger.error(e.message);
      throw new ServiceUnavailableException("image_storage");
    });
    const result = await db.rpc("admin_set_provider_image", { p_id: id, p_public_id: uploaded.publicId, p_url: uploaded.url });
    if (result.error) {
      await cloudinary.destroy(uploaded.publicId).catch(() => false);
      unwrap(result);
    }
    const previous = result.data as string | null;
    if (previous && !(await cloudinary.destroy(previous).catch(() => false))) this.logger.warn(`Ancienne image non effacée : ${previous}`);
    return { url: uploaded.url };
  }
}
