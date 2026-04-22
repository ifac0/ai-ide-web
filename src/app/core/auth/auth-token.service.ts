import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class AuthTokenService {
  getToken(): string | null {
    return localStorage.getItem("auth.token");
  }
}
