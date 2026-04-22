import { inject } from "@angular/core";

import { AuthTokenService } from "../../auth/auth-token.service";

import type { HttpInterceptorFn } from "@angular/common/http";

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthTokenService).getToken();

  if (!token || req.headers.has("Authorization")) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
