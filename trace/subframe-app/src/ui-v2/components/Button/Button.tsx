"use client";
/*
 * Documentation:
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ButtonRootProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "slot"> {
  disabled?: boolean;
  variant?:
    | "primary"
    | "secondary"
    | "white"
    | "outline"
    | "ghost"
    | "brand"
    | "brand-subtle"
    | "gradient"
    | "gradient-outline"
    | "error"
    | "error-subtle"
    | "error-ghost"
    | "error-outline"
    | "white-2"
    | "dashed";
  size?: "medium" | "small" | "xsmall";
  children?: React.ReactNode;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  align?: "center" | "left";
  badge?: boolean;
  slot?: React.ReactNode;
  indicator?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const ButtonRoot = React.forwardRef<HTMLButtonElement, ButtonRootProps>(
  function ButtonRoot(
    {
      disabled = false,
      variant = "secondary",
      size = "medium",
      children,
      icon = null,
      iconRight = null,
      loading = false,
      align = "center",
      badge = false,
      slot,
      indicator = false,
      className,
      type = "button",
      ...otherProps
    }: ButtonRootProps,
    ref
  ) {
    return (
      <button
        className={SubframeUtils.twClassNames(
          "group/3b777358 flex h-12 min-w-[96px] cursor-pointer items-center justify-center gap-2 rounded-rounded-md border-none bg-alpha-slate-8 text-left relative hover:bg-alpha-slate-16 active:bg-alpha-slate-8 disabled:cursor-default disabled:bg-neutral-200 hover:disabled:cursor-default hover:disabled:bg-neutral-200 active:disabled:cursor-default active:disabled:bg-neutral-200",
          {
            "h-8 min-w-[0px] rounded-rounded-xs": size === "xsmall",
            "h-10 min-w-[0px] rounded-rounded-sm": size === "small",
            "border border-dashed border-alpha-slate-12 bg-transparent hover:bg-neutral-100 active:bg-transparent":
              variant === "dashed",
            "bg-default-background hover:bg-neutral-50 active:bg-default-background":
              variant === "white-2",
            "border border-solid border-error-300 bg-neutral-50 hover:bg-error-50 active:bg-error-100":
              variant === "error-outline",
            "bg-transparent hover:bg-error-50 active:bg-error-100":
              variant === "error-ghost",
            "bg-error-100 hover:bg-error-200 active:bg-error-100":
              variant === "error-subtle",
            "bg-error-500 hover:bg-error-600 active:bg-error-500":
              variant === "error",
            "bg-gradient-to-b from-brand-300 via-brand-500 to-fuchsia-500":
              variant === "gradient-outline",
            "bg-accent-vivid-indigo hover:bg-accent-soft-indigo hover:from-brand-500 hover:via-brand-400 hover:to-brand-200 active:bg-accent-vivid-indigo":
              variant === "gradient",
            "border border-solid border-alpha-brand-8 bg-alpha-brand-16 hover:bg-alpha-brand-24 active:bg-alpha-brand-16":
              variant === "brand-subtle",
            "border border-solid border-alpha-slate-4 bg-accent-vivid-bumble-bee hover:bg-accent-default-bumble-bee active:bg-[#ffe61e]":
              variant === "brand",
            "bg-transparent hover:bg-neutral-100 active:bg-neutral-100":
              variant === "ghost",
            "border border-solid border-neutral-border bg-default-background hover:bg-neutral-50 active:bg-default-background":
              variant === "outline",
            "bg-default-background shadow-sm hover:bg-neutral-100 active:bg-neutral-100":
              variant === "white",
            "shadow-[inset_0px_0px_6px_2px_#ffffff3d] bg-gradient-to-b from-neutral-900 to-neutral-800 hover:shadow-[inset_0px_0px_6px_4px_#ffffff3d]":
              variant === "primary",
          },
          className
        )}
        ref={ref}
        type={type}
        disabled={disabled}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-2 w-2 flex-none flex-col items-start gap-2 rounded-full bg-fuchsia-500 absolute top-0 right-0",
            { flex: indicator }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "items-start rounded-[15px] pointer-events-none block absolute inset-0 z-20 group-hover/3b777358:rounded-[14px]",
            {
              "rounded-[7px] group-hover/3b777358:rounded-[6px]":
                size === "xsmall",
              "rounded-[11px] group-hover/3b777358:rounded-[10px]":
                size === "small",
              hidden:
                variant === "dashed" ||
                variant === "white-2" ||
                variant === "error-outline" ||
                variant === "error-ghost" ||
                variant === "brand-subtle" ||
                variant === "ghost" ||
                variant === "outline" ||
                variant === "white",
              "bg-default-background z-10 inset-[1.5px] group-hover/3b777358:inset-[2px]":
                variant === "gradient-outline",
            }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "items-start overflow-hidden rounded-rounded-md pointer-events-none block absolute inset-0 z-20",
            {
              "rounded-rounded-xs": size === "xsmall",
              "rounded-rounded-sm": size === "small",
              hidden: variant === "gradient-outline",
            }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-16 w-16 flex-none items-start rounded-rounded-md absolute animate-pulse scale-100 bg-gradient-to-b from-brand-600 via-fuchsia-500 to-brand-400 blur-md -left-12",
              {
                "flex group-hover/3b777358:h-11 group-hover/3b777358:w-10":
                  variant === "gradient",
              }
            )}
          />
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-16 w-16 flex-none items-start rounded-rounded-md absolute animate-pulse scale-120 bg-gradient-to-b from-brand-600 via-brand-500 to-fuchsia-400 -right-4 -top-12 blur-sm transition-all duration-300",
              {
                "flex group-hover/3b777358:h-32 group-hover/3b777358:w-32":
                  variant === "gradient",
              }
            )}
          />
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex h-12 grow shrink-0 basis-0 items-center justify-center gap-2 overflow-hidden relative z-40",
            { "h-8": size === "xsmall", "h-10": size === "small" }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex grow shrink-0 basis-0 items-center justify-center gap-2 self-stretch rounded-rounded-md px-5 z-10",
              {
                "justify-start": align === "left",
                "rounded-rounded-xs px-3": size === "xsmall",
                "rounded-rounded-sm px-3.5": size === "small",
                "group-hover/3b777358:rounded-[14px]":
                  variant === "gradient-outline",
              }
            )}
          >
            {icon ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[18px] font-[500] leading-[28px] text-neutral-900 group-disabled/3b777358:text-neutral-400",
                  {
                    "hidden text-default-font": loading,
                    "text-[12px] leading-[16px] tracking-normal text-default-font":
                      size === "xsmall",
                    "text-body-2 font-body-2 text-default-font":
                      size === "small",
                    "text-error-600":
                      variant === "error-outline" ||
                      variant === "error-ghost" ||
                      variant === "error-subtle",
                    "text-white":
                      variant === "error" ||
                      variant === "gradient" ||
                      variant === "primary",
                    "text-neutral-800": variant === "gradient-outline",
                    "text-brand-500": variant === "brand-subtle",
                    "text-[#001137]": variant === "brand",
                    "text-neutral-500": variant === "white",
                  }
                )}
              >
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
            <div
              className={SubframeUtils.twClassNames(
                "hidden h-4 w-4 flex-none items-center justify-center gap-2",
                {
                  flex: loading,
                  "h-3 w-3": size === "xsmall" || size === "small",
                }
              )}
            >
              <SubframeCore.Loader
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[12px] font-[400] leading-[20px] text-white group-disabled/3b777358:text-caption group-disabled/3b777358:font-caption group-disabled/3b777358:text-neutral-400",
                  {
                    "text-caption font-caption text-neutral-700":
                      variant === "error-outline" ||
                      variant === "ghost" ||
                      variant === "outline" ||
                      variant === "white" ||
                      variant === "primary",
                    "text-caption font-caption text-error-600":
                      variant === "error-ghost",
                    "text-caption font-caption text-error-700":
                      variant === "error-subtle",
                  }
                )}
              />
            </div>
            {children ? (
              <span
                className={SubframeUtils.twClassNames(
                  "whitespace-nowrap text-button font-button text-neutral-900 text-center pb-px group-disabled/3b777358:text-neutral-400",
                  {
                    "line-clamp-1 grow shrink-0 basis-0 whitespace-normal text-neutral-800 text-left":
                      align === "left",
                    "hidden text-neutral-800": loading,
                    "text-button-xs font-button-xs text-neutral-800":
                      size === "xsmall",
                    "text-error-600":
                      variant === "error-outline" || variant === "error-ghost",
                    "text-error-700": variant === "error-subtle",
                    "text-white":
                      variant === "error" ||
                      variant === "gradient" ||
                      variant === "primary",
                    "text-neutral-800": variant === "gradient-outline",
                    "text-brand-600": variant === "brand-subtle",
                    "text-[#001137]": variant === "brand",
                    "text-neutral-700": variant === "white",
                  }
                )}
              >
                {children}
              </span>
            ) : null}
            {slot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden items-center justify-center gap-2",
                  { flex: badge }
                )}
              >
                {slot}
              </div>
            ) : null}
            {iconRight ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[18px] font-[500] leading-[28px] text-neutral-900 group-disabled/3b777358:text-neutral-400",
                  {
                    hidden: loading,
                    "text-[12px] leading-[16px] tracking-normal text-default-font":
                      size === "xsmall",
                    "text-body-2 font-body-2 text-default-font":
                      size === "small",
                    "text-error-600":
                      variant === "error-outline" ||
                      variant === "error-ghost" ||
                      variant === "error-subtle",
                    "text-white":
                      variant === "error" ||
                      variant === "gradient" ||
                      variant === "primary",
                    "text-neutral-800": variant === "gradient-outline",
                    "text-brand-500": variant === "brand-subtle",
                    "text-[#001137]": variant === "brand",
                  }
                )}
              >
                {iconRight}
              </SubframeCore.IconWrapper>
            ) : null}
          </div>
        </div>
      </button>
    );
  }
);

export const Button = ButtonRoot;
