import { FocusMonitor } from "@angular/cdk/a11y";
import { NgClass } from "@angular/common";
import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  ViewChild,
  inject,
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";

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

  protected sidebarCollapsed = false;

  protected readonly form: PromptForm = new FormGroup({
    prompt: new FormControl("", {
      nonNullable: true,
      validators: [(c) => Validators.required(c)],
    }),
  });

  @ViewChild("sidebarToggle", { static: true })
  private readonly sidebarToggle!: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    this.focusMonitor.monitor(this.sidebarToggle);
    this.destroyRef.onDestroy(() => {
      this.focusMonitor.stopMonitoring(this.sidebarToggle);
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
