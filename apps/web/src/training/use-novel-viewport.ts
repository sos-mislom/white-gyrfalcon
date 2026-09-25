"use client";
import { useEffect, useRef } from "react";

/** Follow the visible viewport when the software keyboard opens; never move game time. */
export function useNovelViewport() {
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    document.body.classList.add("novel-open");
    const viewport = window.visualViewport;
    const update = () => {
      screen.current?.style.setProperty(
        "--scene-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      screen.current?.style.setProperty(
        "--scene-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      document.body.classList.remove("novel-open");
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return screen;
}
