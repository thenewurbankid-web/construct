"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface BadgeRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  style?: "default" | "fill" | "no-fill" | "outline";
  variant?:
    | "default"
    | "neutral"
    | "error"
    | "warning"
    | "success"
    | "dark"
    | "blue"
    | "cyan"
    | "pink"
    | "fuchsia"
    | "brand"
    | "white"
    | "orange"
    | "violet"
    | "brand-02";
  icon?: React.ReactNode;
  children?: React.ReactNode;
  iconRight?: React.ReactNode;
  size?: "default" | "xs";
  className?: string;
}

const BadgeRoot = React.forwardRef<HTMLDivElement, BadgeRootProps>(
  function BadgeRoot(
    {
      style = "default",
      variant = "default",
      icon = null,
      children,
      iconRight = null,
      size = "default",
      className,
      ...otherProps
    }: BadgeRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/97bdb082 flex h-6 items-center justify-center gap-1 overflow-hidden rounded-[6px] px-2 relative",
          { "h-4 rounded-[4px] px-1.5": size === "xs" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex grow shrink-0 basis-0 flex-col items-start gap-2 rounded-[6px] border border-solid border-neutral-50 bg-neutral-50 px-2 py-2 absolute inset-0 mx-auto z-0",
            {
              "rounded-[4px]": size === "xs",
              "border border-solid border-accent-vivid-bumble-bee bg-accent-vivid-bumble-bee":
                variant === "brand-02",
              "border border-solid border-purple-100 bg-purple-100":
                variant === "violet",
              "border border-solid border-orange-100 bg-orange-100":
                variant === "orange",
              "border border-solid border-white bg-white": variant === "white",
              "border border-solid border-brand-50 bg-brand-50":
                variant === "brand",
              "border border-solid border-fuchsia-100 bg-fuchsia-100":
                variant === "fuchsia",
              "border border-solid border-pink-100 bg-pink-100":
                variant === "pink",
              "border border-solid border-cyan-100 bg-cyan-100":
                variant === "cyan",
              "border border-solid border-blue-100 bg-blue-100":
                variant === "blue",
              "border border-solid border-neutral-900 bg-neutral-900":
                variant === "dark",
              "border border-solid border-success-100 bg-success-100":
                variant === "success",
              "border border-solid border-warning-100 bg-warning-100":
                variant === "warning",
              "border border-solid border-error-100 bg-error-100":
                variant === "error",
              "border border-solid border-neutral-100 bg-neutral-100":
                variant === "neutral",
              hidden:
                style === "outline" || style === "no-fill" || style === "fill",
            }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "hidden grow shrink-0 basis-0 flex-col items-start gap-2 rounded-[6px] border border-solid border-neutral-border px-2 py-2 absolute inset-0 mx-auto z-0",
            {
              "rounded-[4px]": size === "xs",
              "border border-solid border-accent-vivid-bumble-bee":
                variant === "brand-02",
              "border border-solid border-purple-500": variant === "violet",
              "border border-solid border-orange-500": variant === "orange",
              "border border-solid border-neutral-700":
                variant === "white" || variant === "dark",
              "border border-solid border-brand-400": variant === "brand",
              "border border-solid border-fuchsia-500": variant === "fuchsia",
              "border border-solid border-pink-500": variant === "pink",
              "border border-solid border-cyan-500": variant === "cyan",
              "border border-solid border-blue-500": variant === "blue",
              "border border-solid border-success-500": variant === "success",
              "border border-solid border-warning-500": variant === "warning",
              "border border-solid border-error-500": variant === "error",
              "bg-neutral-400": variant === "neutral",
              flex: style === "outline",
            }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "hidden grow shrink-0 basis-0 flex-col items-start gap-2 rounded-[6px] bg-neutral-400 px-2 py-2 absolute inset-0 mx-auto z-0",
            {
              "rounded-[4px]": size === "xs",
              "bg-accent-vivid-bumble-bee": variant === "brand-02",
              "bg-purple-500": variant === "violet",
              "bg-orange-300": variant === "orange",
              "bg-neutral-900": variant === "white",
              "bg-brand-400": variant === "brand",
              "bg-fuchsia-600": variant === "fuchsia",
              "bg-pink-600": variant === "pink",
              "bg-cyan-600": variant === "cyan",
              "bg-blue-600": variant === "blue",
              "bg-neutral-800": variant === "dark",
              "bg-success-600": variant === "success",
              "bg-warning-300": variant === "warning",
              "bg-error-600": variant === "error",
              flex: style === "fill",
            }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "flex items-center justify-center gap-1 relative z-10",
            { hidden: style === "no-fill" || style === "fill" }
          )}
        >
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-neutral-600",
                {
                  "text-overline-xs font-overline-xs": size === "xs",
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-purple-700": variant === "violet",
                  "text-orange-700": variant === "orange",
                  "text-neutral-700":
                    variant === "white" || variant === "neutral",
                  "text-brand-600": variant === "brand",
                  "text-fuchsia-700": variant === "fuchsia",
                  "text-pink-700": variant === "pink",
                  "text-cyan-700": variant === "cyan",
                  "text-blue-700": variant === "blue",
                  "text-white": variant === "dark",
                  "text-success-700": variant === "success",
                  "text-warning-700": variant === "warning",
                  "text-error-600": variant === "error",
                }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {children ? (
            <span
              className={SubframeUtils.twClassNames(
                "line-clamp-1 text-button-xs font-button-xs text-neutral-700 pb-px",
                {
                  "text-[10px] font-[500] leading-[10px]": size === "xs",
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-purple-700": variant === "violet",
                  "text-orange-700": variant === "orange",
                  "text-brand-700": variant === "brand",
                  "text-fuchsia-700": variant === "fuchsia",
                  "text-pink-700": variant === "pink",
                  "text-cyan-700": variant === "cyan",
                  "text-blue-700": variant === "blue",
                  "text-white": variant === "dark",
                  "text-success-700": variant === "success",
                  "text-warning-700": variant === "warning",
                  "text-error-600": variant === "error",
                }
              )}
            >
              {children}
            </span>
          ) : null}
          {iconRight ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-neutral-600",
                {
                  "text-overline-xs font-overline-xs": size === "xs",
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-purple-700": variant === "violet",
                  "text-orange-700": variant === "orange",
                  "text-neutral-700":
                    variant === "white" || variant === "neutral",
                  "text-brand-600": variant === "brand",
                  "text-fuchsia-700": variant === "fuchsia",
                  "text-pink-700": variant === "pink",
                  "text-cyan-700": variant === "cyan",
                  "text-blue-700": variant === "blue",
                  "text-white": variant === "dark",
                  "text-success-700": variant === "success",
                  "text-warning-700": variant === "warning",
                  "text-error-600": variant === "error",
                }
              )}
            >
              {iconRight}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-center gap-1 relative z-10",
            { flex: style === "fill" }
          )}
        >
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-white",
                {
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-orange-900": variant === "orange",
                  "text-warning-900": variant === "warning",
                }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {children ? (
            <span
              className={SubframeUtils.twClassNames(
                "line-clamp-1 text-button-xs font-button-xs text-white pb-px",
                {
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-orange-900": variant === "orange",
                  "text-warning-900": variant === "warning",
                }
              )}
            >
              {children}
            </span>
          ) : null}
          {iconRight ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-white",
                {
                  "text-accent-vivid-midnight": variant === "brand-02",
                  "text-orange-900": variant === "orange",
                  "text-warning-900": variant === "warning",
                }
              )}
            >
              {iconRight}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-center gap-1 relative z-10",
            { flex: style === "no-fill" }
          )}
        >
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-neutral-600",
                {
                  "text-accent-default-bumble-bee": variant === "brand-02",
                  "text-purple-600": variant === "violet",
                  "text-orange-600": variant === "orange",
                  "text-neutral-700": variant === "white" || variant === "dark",
                  "text-brand-600": variant === "brand",
                  "text-fuchsia-500": variant === "fuchsia",
                  "text-pink-500": variant === "pink",
                  "text-cyan-500": variant === "cyan",
                  "text-blue-500": variant === "blue",
                  "text-success-500": variant === "success",
                  "text-warning-500": variant === "warning",
                  "text-error-500": variant === "error",
                  "text-neutral-400": variant === "neutral",
                }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {children ? (
            <span
              className={SubframeUtils.twClassNames(
                "line-clamp-1 text-button-xs font-button-xs text-neutral-700 pb-px",
                {
                  "text-accent-default-bumble-bee": variant === "brand-02",
                  "text-purple-600": variant === "violet",
                  "text-orange-600": variant === "orange",
                  "text-brand-700": variant === "brand",
                  "text-fuchsia-600": variant === "fuchsia",
                  "text-pink-600": variant === "pink",
                  "text-cyan-600": variant === "cyan",
                  "text-blue-600": variant === "blue",
                  "text-neutral-800": variant === "dark",
                  "text-success-600": variant === "success",
                  "text-warning-600": variant === "warning",
                  "text-error-600": variant === "error",
                  "text-neutral-600": variant === "neutral",
                }
              )}
            >
              {children}
            </span>
          ) : null}
          {iconRight ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-neutral-600",
                {
                  "text-accent-default-bumble-bee": variant === "brand-02",
                  "text-purple-600": variant === "violet",
                  "text-orange-600": variant === "orange",
                  "text-neutral-700": variant === "white" || variant === "dark",
                  "text-brand-600": variant === "brand",
                  "text-fuchsia-500": variant === "fuchsia",
                  "text-pink-500": variant === "pink",
                  "text-cyan-500": variant === "cyan",
                  "text-blue-500": variant === "blue",
                  "text-success-500": variant === "success",
                  "text-warning-500": variant === "warning",
                  "text-error-500": variant === "error",
                  "text-neutral-400": variant === "neutral",
                }
              )}
            >
              {iconRight}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
      </div>
    );
  }
);

export const Badge = BadgeRoot;
