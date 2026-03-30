/**
 * V2 Pipeline API Client
 * Thin wrapper over the shared request() utility for the unified v2 pipeline.
 */

import { request } from "./apiClient";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  GetProjectResponse,
  IntakeRequest,
  IntakeResponse,
  GeneratePremiseResponse,
  GetPremiseResponse,
  ReviewPremiseRequest,
  ReviewPremiseResponse,
  GenerateBibleResponse,
  GetBibleResponse,
  ReviewScenesRequest,
  ReviewScenesResponse,
  GenerateScenesResponse,
  GetScenesResponse,
} from "../../shared/types/apiV2";

const V2 = "/v2/project";

export const v2Api = {
  createProject(body: CreateProjectRequest) {
    return request<CreateProjectResponse>(`${V2}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getProject(projectId: string) {
    return request<GetProjectResponse>(`${V2}/${projectId}`);
  },

  intake(projectId: string, body: IntakeRequest) {
    return request<IntakeResponse>(`${V2}/${projectId}/intake`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  generatePremise(projectId: string) {
    return request<GeneratePremiseResponse>(`${V2}/${projectId}/generate-premise`, {
      method: "POST",
    });
  },

  getPremise(projectId: string) {
    return request<GetPremiseResponse>(`${V2}/${projectId}/premise`);
  },

  reviewPremise(projectId: string, body: ReviewPremiseRequest) {
    return request<ReviewPremiseResponse>(`${V2}/${projectId}/review-premise`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  generateBible(projectId: string) {
    return request<GenerateBibleResponse>(`${V2}/${projectId}/generate-bible`, {
      method: "POST",
    });
  },

  getBible(projectId: string) {
    return request<GetBibleResponse>(`${V2}/${projectId}/bible`);
  },

  reviewScenes(projectId: string, body: ReviewScenesRequest) {
    return request<ReviewScenesResponse>(`${V2}/${projectId}/review-scenes`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  generateScenes(projectId: string) {
    return request<GenerateScenesResponse>(`${V2}/${projectId}/generate-scenes`, {
      method: "POST",
    });
  },

  getScenes(projectId: string) {
    return request<GetScenesResponse>(`${V2}/${projectId}/scenes`);
  },

  exportProject(projectId: string) {
    return request<any>(`${V2}/${projectId}/export`);
  },

  retry(projectId: string) {
    return request<{ restored: boolean; step: string }>(`${V2}/${projectId}/retry`, {
      method: "POST",
    });
  },

  abort(projectId: string) {
    return request<{ aborted: boolean }>(`${V2}/${projectId}/abort`, {
      method: "POST",
    });
  },
};
