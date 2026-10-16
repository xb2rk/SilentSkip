import { z } from "zod";

/**
 * Application settings contracts (E1 owns `allowedRoots`; AI budgets, editorGen and other
 * keys land with their phases). Settings are stored as JSON values in `app_settings` and
 * always replaced whole — no partial patch semantics at this layer.
 */

export const AppSettingsSchema = z.object({
  allowedRoots: z.array(z.string()),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const UpdateSettingsRequestSchema = z.object({
  allowedRoots: z.array(z.string().min(1)),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
