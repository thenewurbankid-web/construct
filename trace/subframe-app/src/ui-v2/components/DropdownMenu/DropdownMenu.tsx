"use client";
/*
 * Documentation:
 * Dropdown Menu — https://app.subframe.com/de62b029ca8b/library?component=Dropdown+Menu_99951515-459b-4286-919e-a89e7549b43b
 */

import React from "react";
import { FeatherStar } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface DropdownItemProps
  extends React.ComponentProps<typeof SubframeCore.DropdownMenu.Item> {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  slot?: React.ReactNode;
  variant?: "default" | "destructive";
  disabled?: boolean;
  subText?: React.ReactNode;
  className?: string;
}

const DropdownItem = React.forwardRef<HTMLDivElement, DropdownItemProps>(
  function DropdownItem(
    {
      children,
      icon = <FeatherStar />,
      slot,
      variant = "default",
      disabled = false,
      subText,
      className,
      ...otherProps
    }: DropdownItemProps,
    ref
  ) {
    return (
      <SubframeCore.DropdownMenu.Item
        asChild={true}
        disabled={disabled}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "group/adcae8d6 flex min-h-[48px] w-full min-w-[160px] cursor-pointer items-center gap-4 rounded-rounded-md border border-solid border-transparent pl-4 pr-5 py-2 hover:border hover:border-solid hover:border-neutral-100 hover:bg-neutral-50 active:bg-neutral-100 data-[highlighted]:bg-neutral-100",
            {
              "cursor-not-allowed opacity-50 hover:border hover:border-solid hover:border-transparent hover:bg-transparent active:bg-transparent":
                disabled,
              "hover:border hover:border-solid hover:border-error-100 hover:bg-error-50 active:bg-error-100":
                variant === "destructive",
            },
            className
          )}
          ref={ref}
        >
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "text-body-1 font-body-1 text-neutral-600 group-hover/adcae8d6:text-neutral-700",
                {
                  "text-neutral-400 group-hover/adcae8d6:text-neutral-400":
                    disabled,
                  "text-error-700 group-hover/adcae8d6:text-error-800":
                    variant === "destructive",
                }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          <div className="flex grow shrink-0 basis-0 flex-col items-start gap-1">
            {children ? (
              <span
                className={SubframeUtils.twClassNames(
                  "line-clamp-1 w-full text-button font-button text-neutral-700 pb-px group-hover/adcae8d6:text-neutral-800",
                  {
                    "text-neutral-400 group-hover/adcae8d6:text-neutral-400":
                      disabled,
                    "text-error-700 group-hover/adcae8d6:text-error-800":
                      variant === "destructive",
                  }
                )}
              >
                {children}
              </span>
            ) : null}
            {subText ? (
              <span
                className={SubframeUtils.twClassNames(
                  "line-clamp-1 w-full text-caption-xs font-caption-xs text-neutral-500",
                  {
                    "text-neutral-400": disabled,
                    "text-error-500": variant === "destructive",
                  }
                )}
              >
                {subText}
              </span>
            ) : null}
          </div>
          {slot ? <div className="flex items-center gap-4">{slot}</div> : null}
        </div>
      </SubframeCore.DropdownMenu.Item>
    );
  }
);

export interface DropdownDividerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const DropdownDivider = React.forwardRef<HTMLDivElement, DropdownDividerProps>(
  function DropdownDivider(
    { className, ...otherProps }: DropdownDividerProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-start gap-3 px-2 py-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-px grow shrink-0 basis-0 flex-col items-center gap-2 bg-neutral-200" />
      </div>
    );
  }
);

export interface DropdownMenuRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  className?: string;
}

const DropdownMenuRoot = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRootProps
>(function DropdownMenuRoot(
  { children, className, ...otherProps }: DropdownMenuRootProps,
  ref
) {
  return children ? (
    <div
      className={SubframeUtils.twClassNames(
        "flex min-w-[192px] flex-col items-start rounded-[20px] border border-solid border-neutral-50 bg-default-background px-1.5 py-1.5 shadow-xl",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {children}
    </div>
  ) : null;
});

export const DropdownMenu = Object.assign(DropdownMenuRoot, {
  DropdownItem,
  DropdownDivider,
});
