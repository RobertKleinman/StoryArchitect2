import { Request, Response, NextFunction } from "express";
import { FEATURE_FLAGS } from "../featureFlags";

export function plotFeatureFlagGuard(req: Request, res: Response, next: NextFunction) {
  if (!FEATURE_FLAGS.PLOT_MODULE_ENABLED) {
    return res.status(404).json({
      error: true,
      code: "FEATURE_DISABLED",
      message: "Plot module is disabled",
    });
  }
  next();
}
