"use client";
/*
 * Documentation:
 * Scope Node Row — https://app.subframe.com/de62b029ca8b/library?component=Scope+Node+Row_6dffb3f5-eb52-4c30-9f7c-c61719c995b7
 */

import React from "react";
import { FeatherCheck } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherPlus } from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface MarkProps extends React.HTMLAttributes<HTMLDivElement> {
  markType?:
    | "parent-off"
    | "parent-partial"
    | "parent-on"
    | "leaf-off"
    | "leaf-on"
    | "add";
  className?: string;
}

const Mark = React.forwardRef<HTMLDivElement, MarkProps>(function Mark(
  { markType = "parent-off", className, ...otherProps }: MarkProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/e8b80367 flex items-center justify-center",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "hidden h-5 w-5 flex-none items-center justify-center rounded-full border border-dashed border-alpha-slate-32",
          { flex: markType === "add" }
        )}
      >
        <FeatherPlus className="text-caption-xs font-caption-xs text-neutral-400" />
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden h-5 w-5 flex-none items-center justify-center rounded-full border border-solid border-alpha-slate-24",
          { flex: markType === "leaf-off" }
        )}
      />
      <div
        className={SubframeUtils.twClassNames(
          "hidden h-5 w-5 flex-none items-center justify-center rounded-full border border-solid border-brand-500 bg-brand-500",
          { flex: markType === "leaf-on" }
        )}
      >
        <FeatherCheck className="text-caption-xs font-caption-xs text-white" />
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-solid border-alpha-slate-16",
          {
            hidden:
              markType === "add" ||
              markType === "leaf-on" ||
              markType === "leaf-off" ||
              markType === "parent-on" ||
              markType === "parent-partial",
          }
        )}
      />
      <div
        className={SubframeUtils.twClassNames(
          "hidden h-5 w-5 flex-none items-center justify-center rounded-full relative",
          { flex: markType === "parent-partial" }
        )}
      >
        <div className="flex items-start rounded-full border-2 border-solid border-alpha-slate-16 absolute inset-0" />
        <div className="flex items-start rounded-full absolute inset-0 bg-[conic-gradient(var(--color-brand-500)_0deg,var(--color-brand-500)_216deg,transparent_216deg,transparent_360deg)] -rotate-90">
          <div className="flex items-start rounded-full bg-default-background absolute inset-[2.5px]" />
        </div>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-solid border-brand-500 bg-brand-500",
          { flex: markType === "parent-on" }
        )}
      >
        <FeatherCheck className="text-caption-xs font-caption-xs text-white" />
      </div>
    </div>
  );
});

export interface ScopeNodeRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "card" | "tree";
  state?: "off" | "partial" | "on";
  leaf?: boolean;
  label?: React.ReactNode;
  meta?: React.ReactNode;
  badgeSlot?: React.ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  addSlot?: React.ReactNode;
  refineLine?: React.ReactNode;
  refineActionText?: React.ReactNode;
  emphasis?: "default" | "add";
  treeBadgeSlot?: React.ReactNode;
  className?: string;
}

const ScopeNodeRowRoot = React.forwardRef<
  HTMLDivElement,
  ScopeNodeRowRootProps
>(function ScopeNodeRowRoot(
  {
    variant = "card",
    state = "on",
    leaf = false,
    label,
    meta,
    badgeSlot,
    expandable = false,
    expanded = false,
    addSlot,
    refineLine,
    refineActionText,
    emphasis = "default",
    treeBadgeSlot,
    className,
    ...otherProps
  }: ScopeNodeRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/6dffb3f5 flex w-full flex-col items-start",
        { "opacity-60 hover:opacity-100": emphasis === "add" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start rounded-rounded-md border border-solid border-alpha-slate-8 bg-default-background shadow-xs transition-[background-color,border-color,box-shadow] hover:bg-default-background",
          {
            "border border-solid border-transparent shadow-none bg-transparent":
              state === "off",
            hidden: variant === "tree",
          }
        )}
      >
        <div className="flex w-full items-start gap-3.5 px-4 py-4 cursor-pointer text-left">
          <div
            className={SubframeUtils.twClassNames(
              "hidden items-start gap-3.5",
              { flex: leaf }
            )}
          >
            <div
              className={SubframeUtils.twClassNames(
                "hidden h-5 w-5 flex-none items-center justify-center rounded-full border border-solid border-brand-500 bg-brand-500 px-2 py-2",
                {
                  flex: leaf,
                  "border border-solid border-alpha-slate-24 bg-transparent":
                    state === "partial" || state === "off",
                }
              )}
            >
              <FeatherCheck
                className={SubframeUtils.twClassNames(
                  "text-caption-xs font-caption-xs text-white",
                  { hidden: state === "partial" || state === "off" }
                )}
              />
            </div>
          </div>
          <div className="flex items-start gap-3.5 pt-0.5">
            <Mark
              className={SubframeUtils.twClassNames({ hidden: leaf })}
              markType={
                emphasis === "add"
                  ? "add"
                  : state === "partial"
                  ? "parent-partial"
                  : state === "off"
                  ? "parent-off"
                  : "parent-on"
              }
            />
          </div>
          <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1.5">
            <div className="flex w-full flex-wrap items-center gap-2">
              {label ? (
                <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                  {label}
                </span>
              ) : null}
              {badgeSlot ? (
                <div className="flex items-center">{badgeSlot}</div>
              ) : null}
            </div>
            {meta ? (
              <span className="w-full text-caption font-caption text-neutral-500">
                {meta}
              </span>
            ) : null}
          </div>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full items-center justify-between border-t border-solid border-alpha-slate-8 cursor-pointer gap-3 py-3 pl-[52px] pr-4 text-left",
            { hidden: state === "off" }
          )}
        >
          {refineLine ? (
            <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500">
              {refineLine}
            </span>
          ) : null}
          <div className="flex items-center gap-1">
            {refineActionText ? (
              <span className="text-overline-xs-mono font-overline-xs-mono text-accent-vivid-indigo uppercase">
                {refineActionText}
              </span>
            ) : null}
            <FeatherChevronRight className="text-caption-xs font-caption-xs text-accent-vivid-indigo" />
          </div>
        </div>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "hidden w-full items-start gap-3 py-2.5",
          { flex: variant === "tree" }
        )}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-5 w-5 flex-none items-center justify-center rounded-full border border-solid border-brand-500 bg-brand-500",
            {
              flex: leaf,
              "border border-solid border-alpha-slate-24 bg-transparent":
                state === "partial" || state === "off",
            }
          )}
        >
          <FeatherCheck
            className={SubframeUtils.twClassNames(
              "text-caption-xs font-caption-xs text-white",
              { hidden: state === "partial" || state === "off" }
            )}
          />
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-start gap-3 pt-0.5",
            { flex: variant === "tree" }
          )}
        >
          <Mark
            className={SubframeUtils.twClassNames({ hidden: leaf })}
            markType={
              emphasis === "add"
                ? "add"
                : state === "partial"
                ? "parent-partial"
                : state === "off"
                ? "parent-off"
                : "parent-on"
            }
          />
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-4 w-4 flex-none items-center justify-center rounded-rounded-xs cursor-pointer text-neutral-500 transition-transform duration-200 hover:text-default-font",
            { "rotate-90": expanded, flex: expandable }
          )}
        >
          <FeatherChevronRight className="text-caption font-caption text-default-font" />
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1",
            { "opacity-40 group-hover/6dffb3f5:opacity-70": state === "off" }
          )}
        >
          <div className="flex w-full flex-wrap items-center gap-2">
            {label ? (
              <span className="text-subtitle-2 font-subtitle-2 text-default-font">
                {label}
              </span>
            ) : null}
            {treeBadgeSlot ? (
              <div className="flex items-center">{treeBadgeSlot}</div>
            ) : null}
          </div>
          {meta ? (
            <span className="w-full text-caption-xs font-caption-xs text-neutral-500">
              {meta}
            </span>
          ) : null}
        </div>
        {addSlot ? <div className="flex items-center">{addSlot}</div> : null}
      </div>
    </div>
  );
});

export const ScopeNodeRow = Object.assign(ScopeNodeRowRoot, {
  Mark,
});
