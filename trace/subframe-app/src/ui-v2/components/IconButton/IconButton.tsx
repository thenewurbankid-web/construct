"use client";
/*
 * Documentation:
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 */

import React from "react";
import { FeatherPlus } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface IconButtonRootProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
    | "error"
    | "error-subtle"
    | "error-ghost"
    | "error-outline"
    | "inverse"
    | "dashed"
    | "gradient-outline";
  size?: "medium" | "small" | "xsmall";
  icon?: React.ReactNode;
  loading?: boolean;
  indicator?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}

const IconButtonRoot = React.forwardRef<HTMLButtonElement, IconButtonRootProps>(
  function IconButtonRoot(
    {
      disabled = false,
      variant = "secondary",
      size = "medium",
      icon = <FeatherPlus />,
      loading = false,
      indicator = false,
      className,
      type = "button",
      ...otherProps
    }: IconButtonRootProps,
    ref
  ) {
    return (
      <button
        className={SubframeUtils.twClassNames(
          "group/af9405b1 flex h-12 w-12 cursor-pointer items-center justify-center gap-2 rounded-rounded-md border-none bg-alpha-slate-8 text-left relative hover:bg-alpha-slate-16 active:bg-alpha-slate-8 disabled:cursor-default disabled:bg-neutral-200 hover:disabled:cursor-default hover:disabled:bg-neutral-200 active:disabled:cursor-default active:disabled:bg-neutral-200",
          {
            "h-8 w-8 rounded-rounded-xs": size === "xsmall",
            "h-10 w-10 rounded-rounded-sm": size === "small",
            "bg-gradient-to-b from-brand-300 via-brand-500 to-fuchsia-500":
              variant === "gradient-outline",
            "border border-dashed border-alpha-slate-12 bg-transparent hover:bg-neutral-100 active:bg-transparent":
              variant === "dashed",
            "bg-default-background hover:bg-neutral-50 active:bg-default-background":
              variant === "inverse",
            "border border-solid border-error-300 bg-neutral-50 hover:bg-error-50 active:bg-error-100":
              variant === "error-outline",
            "bg-transparent hover:bg-error-50 active:bg-error-100":
              variant === "error-ghost",
            "bg-error-100 hover:bg-error-200 active:bg-error-100":
              variant === "error-subtle",
            "bg-error-500 hover:bg-error-600 active:bg-error-500":
              variant === "error",
            "bg-accent-default-indigo hover:bg-accent-soft-indigo hover:from-brand-500 hover:via-brand-400 hover:to-brand-200 active:bg-accent-vivid-indigo":
              variant === "gradient",
            "border border-solid border-alpha-brand-8 bg-alpha-brand-16 hover:bg-alpha-brand-24 active:bg-alpha-brand-16":
              variant === "brand-subtle",
            "bg-accent-vivid-bumble-bee hover:bg-accent-default-bumble-bee active:bg-[#ffe61e]":
              variant === "brand",
            "bg-transparent hover:bg-neutral-100 active:bg-neutral-100":
              variant === "ghost",
            "border border-solid border-neutral-border bg-default-background hover:bg-neutral-50 active:bg-default-background":
              variant === "outline",
            "bg-neutral-50 hover:bg-neutral-100 active:bg-neutral-100":
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
            "hidden items-start rounded-[15px] bg-default-background pointer-events-none absolute z-10 group-hover/af9405b1:rounded-[14px]",
            {
              "rounded-[7px] group-hover/af9405b1:rounded-[6px]":
                size === "xsmall",
              "rounded-[11px] group-hover/af9405b1:rounded-[10px]":
                size === "small",
              "block inset-[1.5px] group-hover/af9405b1:inset-[2px]":
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
            }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-14 w-11 flex-none items-start rounded-rounded-md absolute bg-gradient-to-b from-brand-600 via-brand-400 to-brand-200 blur -left-8 -top-6 transition-all duration-300 group-disabled/af9405b1:absolute group-disabled/af9405b1:bg-gradient-to-b group-disabled/af9405b1:from-neutral-600 group-disabled/af9405b1:via-neutral-400 group-disabled/af9405b1:to-neutral-200 group-disabled/af9405b1:blur group-disabled/af9405b1:-left-8 group-disabled/af9405b1:-top-6 group-disabled/af9405b1:transition-all group-disabled/af9405b1:duration-300",
              {
                "flex group-hover/af9405b1:h-12 group-hover/af9405b1:w-10":
                  variant === "gradient",
              }
            )}
          />
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-16 w-12 flex-none items-start rounded-rounded-md absolute bg-gradient-to-b from-brand-600 via-brand-500 to-brand-400 -right-8 -top-8 blur-md transition-all duration-300 group-disabled/af9405b1:absolute group-disabled/af9405b1:bg-gradient-to-b group-disabled/af9405b1:from-neutral-600 group-disabled/af9405b1:via-neutral-500 group-disabled/af9405b1:to-neutral-400 group-disabled/af9405b1:-right-8 group-disabled/af9405b1:-top-8 group-disabled/af9405b1:blur-md group-disabled/af9405b1:transition-all group-disabled/af9405b1:duration-300",
              {
                "flex group-hover/af9405b1:h-11 group-hover/af9405b1:w-10":
                  variant === "gradient",
              }
            )}
          />
        </div>
        <div className="flex grow shrink-0 basis-0 items-center justify-center gap-2 self-stretch relative z-40">
          <div className="flex items-center justify-center gap-2 z-10">
            {icon ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "font-['Inter_Tight'] text-[18px] font-[500] leading-[28px] text-neutral-900 group-disabled/af9405b1:text-neutral-400",
                  {
                    hidden: loading,
                    "text-[12px] leading-[16px] tracking-normal":
                      size === "xsmall",
                    "text-body-2-bold font-body-2-bold": size === "small",
                    "text-neutral-800": variant === "gradient-outline",
                    "text-error-600":
                      variant === "error-outline" || variant === "error-subtle",
                    "text-error-700": variant === "error-ghost",
                    "text-white":
                      variant === "error" ||
                      variant === "gradient" ||
                      variant === "primary",
                    "text-brand-500": variant === "brand-subtle",
                    "text-accent-vivid-midnight": variant === "brand",
                    "text-neutral-700": variant === "white",
                  }
                )}
              >
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
            <SubframeCore.Loader
              className={SubframeUtils.twClassNames(
                "hidden font-['Inter_Tight'] text-[18px] font-[500] leading-[28px] text-neutral-700 group-disabled/af9405b1:text-neutral-400",
                {
                  "inline-block": loading,
                  "text-[12px] leading-[16px] tracking-normal":
                    size === "xsmall",
                  "text-body-2-bold font-body-2-bold": size === "small",
                  "text-error-600":
                    variant === "error-outline" || variant === "error-subtle",
                  "text-error-700": variant === "error-ghost",
                  "text-white":
                    variant === "error" ||
                    variant === "gradient" ||
                    variant === "primary",
                  "text-brand-500": variant === "brand-subtle",
                  "text-accent-vivid-midnight": variant === "brand",
                }
              )}
            />
          </div>
        </div>
      </button>
    );
  }
);

export const IconButton = IconButtonRoot;
