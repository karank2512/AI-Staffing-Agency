"use client";

import { useEffect } from "react";

/**
 * One shared IntersectionObserver for every `[data-reveal]` element on the page.
 *
 * The hidden start state lives in globals.css behind `@media (scripting: enabled)`, so crawlers, thumbnails
 * and no-JS visitors always see the content; this island only flips `data-revealed` once per element and
 * then stops watching it. `prefers-reduced-motion` is handled by the tokens (duration 0, distance 0), so
 * there is no motion branch here.
 */
export function ScrollReveal() {
  useEffect(() => {
    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-revealed])")];
    if (targets.length === 0) return;

    // Very old browsers (and some in-app webviews) have no observer: show everything rather than nothing.
    if (typeof IntersectionObserver === "undefined") {
      for (const element of targets) element.dataset.revealed = "";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealed = "";
          observer.unobserve(entry.target);
        }
      },
      // threshold 0 + a 10% bottom inset: an element reveals as its top crosses 90% of the viewport, which
      // also works for mocks that are taller than the screen (a ratio threshold would never fire on those).
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );

    for (const element of targets) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return null;
}
