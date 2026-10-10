"use client";
/*
 * Documentation:
 * TabWithCount — https://app.subframe.com/de62b029ca8b/library?component=TabWithCount_bfa40b88-9436-4f2e-b730-4abf9610bccf
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface ItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  active?: boolean;
  size?: "lg" | "md" | "sm";
  variant?: "count" | "indicator-error" | "indicator-success" | "indicator-new";
  count?: React.ReactNode;
  title?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    active = false,
    size = "lg",
    variant = "count",
    count,
    title,
    disabled = false,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/72a19211 flex cursor-pointer flex-col items-start gap-2 pr-4",
        { "pr-3": size === "sm" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames("flex items-start gap-2", {
          "gap-1": size === "sm" || size === "md",
        })}
      >
        {title ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-h4 font-h4 text-neutral-600 group-hover/72a19211:text-accent-soft-indigo",
              {
                "text-neutral-300 group-hover/72a19211:text-neutral-300":
                  disabled,
                "text-subtitle-1 font-subtitle-1": size === "sm",
                "text-h6 font-h6": size === "md",
                "text-accent-vivid-indigo group-hover/72a19211:text-accent-vivid-indigo":
                  active,
              }
            )}
          >
            {title}
          </span>
        ) : null}
        <div
          className={SubframeUtils.twClassNames(
            "flex items-end gap-4 pt-0.5 pb-2",
            { "pb-0": size === "sm" }
          )}
        >
          {count ? (
            <span
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-neutral-600",
                {
                  "text-neutral-400": disabled,
                  hidden:
                    variant === "indicator-new" ||
                    variant === "indicator-success" ||
                    variant === "indicator-error",
                }
              )}
            >
              {count}
            </span>
          ) : null}
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-[#c026d3]",
              {
                flex: variant === "indicator-new",
                "flex bg-success-600": variant === "indicator-success",
                "flex bg-error-600": variant === "indicator-error",
              }
            )}
          />
        </div>
      </div>
    </div>
  );
});

export interface TabWithCountRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  size?: "lg" | "md" | "sm";
  className?: string;
}

const TabWithCountRoot = React.forwardRef<
  HTMLDivElement,
  TabWithCountRootProps
>(function TabWithCountRoot(
  { children, size = "lg", className, ...otherProps }: TabWithCountRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/bfa40b88 flex flex-wrap items-center border-b border-solid border-alpha-slate-12 pb-3",
        { "gap-1 pb-1.5": size === "sm", "gap-2 pb-2": size === "md" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {children ? (
        <div
          className={SubframeUtils.twClassNames(
            "flex flex-wrap items-center gap-4",
            { "flex-nowrap gap-2": size === "sm" }
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
});

export const TabWithCount = Object.assign(TabWithCountRoot, {
  Item,
});
