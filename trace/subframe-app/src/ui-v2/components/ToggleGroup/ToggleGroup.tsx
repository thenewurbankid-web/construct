"use client";
/*
 * Documentation:
 * Toggle Group — https://app.subframe.com/de62b029ca8b/library?component=Toggle+Group_2026f10a-e3cc-4c89-80da-a7259acae3b7
 */

import React from "react";
import { FeatherStar } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ItemProps
  extends React.ComponentProps<typeof SubframeCore.ToggleGroup.Item> {
  disabled?: boolean;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  large?: boolean;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    disabled = false,
    children,
    icon = <FeatherStar />,
    large = false,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <SubframeCore.ToggleGroup.Item
      asChild={true}
      disabled={disabled}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames(
          "group/56dea6ed flex h-7 w-full cursor-pointer items-center justify-center gap-2 rounded-rounded-md px-2 py-1 active:bg-neutral-100 aria-[checked=true]:rounded-rounded-xs aria-[checked=true]:bg-default-background aria-[checked=true]:shadow-[0px_1px_2px_0px_#11162a0d] active:aria-[checked=true]:bg-default-background",
          { "h-auto px-3 py-2": large, "active:bg-transparent": disabled },
          className
        )}
        ref={ref}
      >
        {icon ? (
          <SubframeCore.IconWrapper
            className={SubframeUtils.twClassNames(
              "text-body-2 font-body-2 text-subtext-color group-hover/56dea6ed:text-default-font group-aria-[checked=true]/56dea6ed:text-default-font",
              {
                "font-[600] tracking-tight": large,
                "text-neutral-400 group-hover/56dea6ed:text-neutral-400 group-active/56dea6ed:text-neutral-400":
                  disabled,
              }
            )}
          >
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
        {children ? (
          <span
            className={SubframeUtils.twClassNames(
              "whitespace-nowrap font-['Inter_Tight'] text-[12px] font-[500] leading-[16px] text-subtext-color group-hover/56dea6ed:text-default-font group-aria-[checked=true]/56dea6ed:text-default-font",
              {
                "text-[14px] font-[600] leading-[20px] tracking-tight": large,
                "text-neutral-400 group-hover/56dea6ed:text-neutral-400 group-active/56dea6ed:text-neutral-400":
                  disabled,
              }
            )}
          >
            {children}
          </span>
        ) : null}
      </div>
    </SubframeCore.ToggleGroup.Item>
  );
});

export interface ToggleGroupRootProps
  extends React.ComponentProps<typeof SubframeCore.ToggleGroup.Root> {
  children?: React.ReactNode;
  variant?: "default" | "large";
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

const ToggleGroupRoot = React.forwardRef<HTMLDivElement, ToggleGroupRootProps>(
  function ToggleGroupRoot(
    {
      children,
      variant = "default",
      className,
      ...otherProps
    }: ToggleGroupRootProps,
    ref
  ) {
    return children ? (
      <SubframeCore.ToggleGroup.Root asChild={true} {...otherProps}>
        <div
          className={SubframeUtils.twClassNames(
            "group/2026f10a flex items-center gap-0.5 overflow-hidden rounded-rounded-md bg-neutral-100 px-0.5 py-0.5",
            { "h-12 px-1.5": variant === "large" },
            className
          )}
          ref={ref}
        >
          {children}
        </div>
      </SubframeCore.ToggleGroup.Root>
    ) : null;
  }
);

export const ToggleGroup = Object.assign(ToggleGroupRoot, {
  Item,
});
