import { z } from "zod";
/** Opaque, case-sensitive identity; 1–128 UTF-16 units, never a path or filename. */
export const identitySchema = z.string().min(1).max(128);
