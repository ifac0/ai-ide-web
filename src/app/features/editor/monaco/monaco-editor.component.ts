import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  inject,
} from "@angular/core";

interface Disposable {
  dispose(): void;
}

interface MonacoTextModel {
  getValue(): string;
  onDidChangeContent(listener: () => void): Disposable;
  dispose(): void;
}

interface MonacoStandaloneEditor {
  dispose(): void;
}

interface MonacoGlobal {
  editor: {
    createModel(value: string, language?: string): MonacoTextModel;
    create(
      element: HTMLElement,
      options: {
        model: MonacoTextModel;
        theme: "vs-dark" | "vs";
        automaticLayout: boolean;
        minimap: { enabled: boolean };
        scrollBeyondLastLine: boolean;
        fontFamily: string;
        fontSize: number;
      },
    ): MonacoStandaloneEditor;
  };
}

interface AmdRequire {
  config(options: { paths: Record<string, string> }): void;
  (
    deps: string[],
    onLoad: () => void,
    onError?: (error: unknown) => void,
  ): void;
}

interface MonacoEnvironmentGlobal {
  getWorkerUrl(moduleId: string, label: string): string;
}

@Component({
  selector: "app-monaco-editor",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div #host class="h-full w-full"></div>',
})
export class MonacoEditorComponent implements AfterViewInit {
  @ViewChild("host", { static: true })
  private readonly host!: ElementRef<HTMLElement>;

  @Input({ required: true }) value!: string;
  @Input() language = "typescript";
  @Input() theme: "vs-dark" | "vs" = "vs-dark";

  @Output() valueChange = new EventEmitter<string>();

  private readonly destroyRef = inject(DestroyRef);

  private static loaderPromise: Promise<void> | null = null;

  private editor: MonacoStandaloneEditor | null = null;
  private model: MonacoTextModel | null = null;

  ngAfterViewInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    await this.ensureMonacoLoaded();

    const monaco = this.getMonaco();
    const model = monaco.editor.createModel(this.value, this.language);
    this.model = model;

    this.editor = monaco.editor.create(this.host.nativeElement, {
      model,
      theme: this.theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "var(--font-mono)",
      fontSize: 13,
    });

    const subscription = model.onDidChangeContent(() => {
      this.valueChange.emit(model.getValue());
    });

    this.destroyRef.onDestroy(() => {
      subscription.dispose();
      this.editor?.dispose();
      this.model?.dispose();
    });
  }

  private async ensureMonacoLoaded(): Promise<void> {
    if ((window as unknown as { monaco?: MonacoGlobal }).monaco) return;
    if (MonacoEditorComponent.loaderPromise) {
      await MonacoEditorComponent.loaderPromise;
      return;
    }

    this.setMonacoEnvironment();

    MonacoEditorComponent.loaderPromise = new Promise<void>(
      (resolve, reject) => {
        const script = document.createElement("script");
        script.src = "/assets/monaco/vs/loader.js";
        script.async = true;
        script.onload = () => {
          const req = this.getAmdRequire();
          if (!req) {
            reject(new Error("Monaco loader not available"));
            return;
          }

          req.config({ paths: { vs: "/assets/monaco/vs" } });
          req(["vs/editor/editor.main"], () => resolve(), reject);
        };
        script.onerror = () =>
          reject(new Error("Failed to load Monaco loader"));
        document.head.appendChild(script);
      },
    );

    await MonacoEditorComponent.loaderPromise;
  }

  private setMonacoEnvironment(): void {
    const w = window as unknown as {
      MonacoEnvironment?: MonacoEnvironmentGlobal;
    };
    if (w.MonacoEnvironment) return;

    const origin = window.location.origin;
    const workerMain = `${origin}/assets/monaco/vs/base/worker/workerMain.js`;
    const baseUrl = `${origin}/assets/monaco/`;

    w.MonacoEnvironment = {
      getWorkerUrl: (_moduleId: string, _label: string) => {
        const code = [
          `self.MonacoEnvironment={baseUrl:${JSON.stringify(baseUrl)}};`,
          `importScripts(${JSON.stringify(workerMain)});`,
        ].join("");

        return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
      },
    };
  }

  private getAmdRequire(): AmdRequire {
    const w = window as unknown as { require?: AmdRequire };
    if (!w.require) {
      throw new Error("AMD require not available");
    }
    return w.require;
  }

  private getMonaco(): MonacoGlobal {
    const w = window as unknown as { monaco?: MonacoGlobal };
    if (!w.monaco) {
      throw new Error("Monaco not available");
    }
    return w.monaco;
  }
}
