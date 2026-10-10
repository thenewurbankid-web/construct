"use client";
/*
 * Documentation:
 * CitationChip — https://app.subframe.com/de62b029ca8b/library?component=CitationChip_6042c713-9100-4e50-b23d-f37c2daedde7
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface CitationChipRootProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: React.ReactNode;
  tier?:
    | "contracted"
    | "transactional"
    | "benchmark"
    | "regulatory"
    | "supplier"
    | "inferred";
  kind?: "citation" | "overflow";
  pinned?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const CitationChipRoot = React.forwardRef<
  HTMLButtonElement,
  CitationChipRootProps
>(function CitationChipRoot(
  {
    label,
    tier = "contracted",
    kind = "citation",
    pinned = false,
    disabled = false,
    className,
    type = "button",
    ...otherProps
  }: CitationChipRootProps,
  ref
) {
  return (
    <button
      className={SubframeUtils.twClassNames(
        "group/6042c713 h-5 cursor-pointer items-center gap-0.5 rounded-rounded-xs border-none bg-alpha-slate-4 px-1 text-left group/citation inline-flex align-baseline outline-none transition-colors hover:bg-alpha-brand-8 focus-within:bg-alpha-brand-8 focus-within:ring-2 focus-within:ring-brand-400 focus-within:ring-offset-1",
        { "ring-1 ring-inset ring-alpha-brand-32": pinned },
        className
      )}
      ref={ref}
      type={type}
      disabled={disabled}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex h-3 w-1 flex-none items-start rounded-full bg-accent-vivid-indigo",
          {
            hidden: kind === "overflow" || tier === "inferred",
            "bg-warning-500": tier === "supplier",
            "bg-neutral-800": tier === "regulatory",
            "bg-accent-default-aqua": tier === "benchmark",
            "bg-brand-500": tier === "transactional",
          }
        )}
      />
      {label ? (
        <span
          className={SubframeUtils.twClassNames(
            "hidden text-caption-mono font-caption-mono text-neutral-400 transition-colors group-hover/6042c713:text-brand-600 group-focus-within/6042c713:text-brand-600",
            { "text-brand-700": pinned, inline: kind === "overflow" }
          )}
        >
          {label}
        </span>
      ) : null}
      <span
        className={SubframeUtils.twClassNames(
          "hidden text-caption-mono font-caption-mono text-neutral-400 transition-colors group-hover/6042c713:text-brand-600 group-focus-within/6042c713:text-brand-600",
          { "text-brand-700": pinned, inline: tier === "inferred" }
        )}
      >
        ~
      </span>
      {label ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-caption-mono font-caption-mono text-neutral-600 transition-colors group-hover/6042c713:text-brand-600 group-focus-within/6042c713:text-brand-600",
            {
              "text-brand-700": pinned,
              hidden: kind === "overflow" || tier === "inferred",
            }
          )}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
});

export const CitationChip = CitationChipRoot;
