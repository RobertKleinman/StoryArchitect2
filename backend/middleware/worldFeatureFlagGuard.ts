import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function worldFeatureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.WORLD_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "World module is disabled",
    });
  }
  next();
}
