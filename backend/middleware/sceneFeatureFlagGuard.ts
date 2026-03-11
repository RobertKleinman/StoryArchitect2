import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function sceneFeatureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.SCENE_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Scene module is disabled",
    });
  }
  next();
}
