import { FocusMonitor } from "@angular/cdk/a11y";
import { DOCUMENT, NgClass } from "@angular/common";
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  ViewChild,
  inject,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { fromEvent } from "rxjs";

import { MonacoEditorComponent } from "../../editor/monaco/monaco-editor.component";
import { IdeStore } from "../state/ide.store";

type PromptForm = FormGroup<{
  prompt: FormControl<string>;
}>;

@Component({
  selector: "app-ide-shell",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, ReactiveFormsModule, MonacoEditorComponent],
  templateUrl: "./ide-shell.component.html",
})
export class IdeShellComponent implements AfterViewInit {
  protected readonly store = inject(IdeStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly focusMonitor = inject(FocusMonitor);
  private readonly document = inject(DOCUMENT);

  protected sidebarCollapsed = false;

  protected readonly form: PromptForm = new FormGroup({
    prompt: new FormControl("", {
      nonNullable: true,
      validators: [(c) => Validators.required(c)],
    }),
  });

  @ViewChild("sidebarToggle", { static: true })
  private readonly sidebarToggle!: ElementRef<HTMLElement>;

  @ViewChild("promptInput")
  private readonly promptInput?: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void {
    this.focusMonitor.monitor(this.sidebarToggle);
    this.destroyRef.onDestroy(() => {
      this.focusMonitor.stopMonitoring(this.sidebarToggle);
    });

    fromEvent<KeyboardEvent>(this.document, "keydown")
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (e.key === "Escape") {
          this.store.cancelStream();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
          e.preventDefault();
          this.store.openScratchTab();
          return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          this.promptInput?.nativeElement.focus();
        }
      });
  }

  protected toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  protected submitPrompt(): void {
    if (this.form.invalid) return;
    const prompt = this.form.controls.prompt.value;
    this.store.streamPrompt(prompt);
  }
}
