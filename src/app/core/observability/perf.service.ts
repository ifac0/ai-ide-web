import { Injectable } from "@angular/core";

@Injectable({ providedIn: "root" })
export class PerfService {
  mark(name: string): void {
    if (typeof performance === "undefined") return;
    if (typeof performance.mark !== "function") return;
    performance.mark(name);
  }

  measure(name: string, startMark: string, endMark: string): void {
    if (typeof performance === "undefined") return;
    if (typeof performance.measure !== "function") return;
    performance.measure(name, startMark, endMark);
  }
}
