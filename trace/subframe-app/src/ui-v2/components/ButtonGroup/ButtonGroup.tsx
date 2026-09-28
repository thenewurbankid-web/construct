"use client";
/*
 * Documentation:
 * Button Group — https://app.subframe.com/de62b029ca8b/library?component=Button+Group_ef1f98df-8fee-4ea7-89f0-7f91f1ddd2c8
 */

import React from "react";
import { FeatherPlus } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "slot"> {
  variant?: "outline" | "gradient" | "brand" | "primary";
  size?: "default" | "sm" | "xs";
  children?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  slot?: boolean;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    variant = "outline",
    size = "default",
    children,
    badge,
    disabled = false,
    icon = <FeatherPlus />,
    iconRight = <FeatherPlus />,
    slot = false,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/5d5a8ef6 flex h-12 cursor-pointer items-center justify-center gap-2 px-3.5 border-r border-solid border-alpha-slate-96/10 text-left last:border-r-0 hover:bg-alpha-slate-8",
        {
          "pointer-events-none opacity-40": disabled,
          "h-8 px-3": size === "xs",
          "h-10": size === "sm",
          "border-y-0 border-l-0 border-r border-solid border-white/10 text-left last:border-r-0 hover:bg-alpha-white-12 active:bg-alpha-white-16":
            variant === "primary",
          "border-y-0 border-l-0 border-r border-solid border-accent-vivid-midnight/10 text-left last:border-r-0 hover:bg-alpha-white-8 active:bg-alpha-white-16":
            variant === "brand",
          "border-r border-solid border-white-alt/30 text-left last:border-r-0 hover:bg-alpha-white-16":
            variant === "gradient",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[600] leading-[20px] tracking-[0.03em] text-neutral-900",
            {
              "text-button-xs font-button-xs": size === "xs",
              "text-[16px] leading-[16px]": size === "sm",
              "text-white": variant === "primary",
              "text-accent-vivid-midnight": variant === "brand",
              "text-white-alt": variant === "gradient",
            }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "whitespace-nowrap text-button font-button text-neutral-900 pb-px",
            {
              "text-button-xs font-button-xs": size === "xs",
              "text-white": variant === "primary",
              "text-accent-vivid-midnight": variant === "brand",
              "text-white-alt": variant === "gradient",
            }
          )}
        >
          {children}
        </span>
      ) : null}
      {badge ? (
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-center justify-center gap-2",
            { flex: slot }
          )}
        >
          {badge}
        </div>
      ) : null}
      {iconRight ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[600] leading-[20px] tracking-[0.03em] text-neutral-900",
            {
              "text-button-xs font-button-xs": size === "xs",
              "text-[16px] leading-[16px]": size === "sm",
              "text-white": variant === "primary",
              "text-accent-vivid-midnight": variant === "brand",
              "text-white-alt": variant === "gradient",
            }
          )}
        >
          {iconRight}
        </SubframeCore.IconWrapper>
      ) : null}
    </div>
  );
});

export interface ButtonGroupRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "outline" | "brand" | "gradient" | "primary";
  size?: "default" | "sm" | "xs";
  children?: React.ReactNode;
  className?: string;
}

const ButtonGroupRoot = React.forwardRef<HTMLDivElement, ButtonGroupRootProps>(
  function ButtonGroupRoot(
    {
      variant = "outline",
      size = "default",
      children,
      className,
      ...otherProps
    }: ButtonGroupRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/ef1f98df flex h-12 items-center overflow-hidden rounded-rounded-md border border-solid border-neutral-border bg-default-background relative",
          {
            "h-8 rounded-rounded-xs": size === "xs",
            "h-10 rounded-rounded-sm": size === "sm",
            "border border-solid border-alpha-white-8 shadow-[inset_0px_0px_6px_2px_#ffffff1f] bg-gradient-to-b from-neutral-900 to-neutral-800":
              variant === "primary",
            "border border-solid border-alpha-white-8 bg-brand-500":
              variant === "gradient",
            "border border-solid border-alpha-slate-4 bg-accent-vivid-bumble-bee":
              variant === "brand",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-start overflow-hidden pointer-events-none absolute inset-0 z-0",
            { flex: variant === "gradient" }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-36 w-36 flex-none items-start rounded-rounded-md absolute bg-gradient-to-b from-brand-600 via-brand-500 to-brand-400 -right-24 -top-20 blur-md transition-all duration-300",
              { flex: variant === "gradient" }
            )}
          />
          <div
            className={SubframeUtils.twClassNames(
              "hidden h-32 w-32 flex-none items-start rounded-rounded-md absolute bg-gradient-to-b from-fuchsia-500 via-brand-400 to-brand-200 -left-16 -top-16 blur-md transition-all duration-300",
              { flex: variant === "gradient" }
            )}
          />
        </div>
        {children ? (
          <div className="flex grow shrink-0 basis-0 items-center self-stretch relative z-10">
            {children}
          </div>
        ) : null}
      </div>
    );
  }
);

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Item,
});
