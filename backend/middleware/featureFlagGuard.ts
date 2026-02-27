import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function featureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.HOOK_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Hook module is disabled",
    });
  }
  next();
}
