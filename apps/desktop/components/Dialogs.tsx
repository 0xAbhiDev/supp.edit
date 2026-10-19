import { useEffect, useRef, useState } from "react";
import { X, ArrowUpRight, Monitor as MonitorIcon } from "lucide-react";
import {
  newProject,
  parseProject,
  type Project,
} from "../../../packages/project-schema";
import { IconButton } from "./Controls";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const el = root.current!;
    const focus = el.querySelector<HTMLElement>("input,button,select,textarea");
    focus?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,textarea,[tabindex="0"]',
          ),
        ),
        first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    el.addEventListener("keydown", trap);
    return () => {
      el.removeEventListener("keydown", trap);
      before?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={root}
      >
        <div className="panel-heading">
          <span>{title}</span>
          <IconButton label={`Close ${title}`} onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}
export function NewProject({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (p: Project) => void;
}) {
  const [name, setName] = useState("Untitled project"),
    [size, setSize] = useState("1920x1080"),
    [rate, setRate] = useState("30/1");
  return (
    <Modal title="New project" onClose={onClose}>
      <form
        className="modal-body"
        onSubmit={(e) => {
          e.preventDefault();
          const [w, h] = size.split("x").map(Number),
            [num, den] = rate.split("/").map(Number);
          onCreate(
            parseProject(
              newProject(name.trim() || "Untitled project", w, h, { num, den }),
            ),
          );
        }}
      >
        <div className="new-project-mark">
          <MonitorIcon size={28} />
        </div>
        <h2>A new beginning.</h2>
        <p>One project for your footage, graphics, and sound.</p>
        <label>
          Project name
          <input
            autoFocus
            required
            maxLength={256}
            aria-label="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="two-fields">
          <label>
            Canvas
            <select
              aria-label="Project canvas"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="1920x1080">1920 × 1080 · Landscape</option>
              <option value="1080x1920">1080 × 1920 · Portrait</option>
              <option value="1080x1080">1080 × 1080 · Square</option>
              <option value="1280x720">1280 × 720 · HD</option>
              <option value="3840x2160">3840 × 2160 · UHD</option>
            </select>
          </label>
          <label>
            Frame rate
            <select
              aria-label="Project frame rate"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            >
              {[
                "24/1",
                "25/1",
                "30000/1001",
                "30/1",
                "50/1",
                "60000/1001",
                "60/1",
                "120/1",
              ].map((v) => (
                <option key={v} value={v}>
                  {(Number(v.split("/")[0]) / Number(v.split("/")[1]))
                    .toFixed(3)
                    .replace(".000", "")}{" "}
                  fps
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-hint">
          sRGB · Local-first · Choose a file location when saving.
        </p>
        <button className="primary wide" type="submit">
          Create project
          <ArrowUpRight size={15} />
        </button>
      </form>
    </Modal>
  );
}
