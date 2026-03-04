import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function characterImageFeatureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.CHARACTER_IMAGE_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Character image module is disabled",
    });
  }
  next();
}
