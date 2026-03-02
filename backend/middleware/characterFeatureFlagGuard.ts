import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function characterFeatureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.CHARACTER_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Character module is disabled",
    });
  }
  next();
}
