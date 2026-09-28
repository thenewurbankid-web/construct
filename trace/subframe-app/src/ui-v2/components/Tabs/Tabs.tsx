"use client";
/*
 * Documentation:
 * Tabs — https://app.subframe.com/de62b029ca8b/library?component=Tabs_e1ad5091-8ad8-4319-b1f7-3e47f0256c20
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface ItemProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  badge?: boolean;
  badge2?: React.ReactNode;
  small?: boolean;
  className?: string;
}

const Item = React.forwardRef<HTMLDivElement, ItemProps>(function Item(
  {
    active = false,
    disabled = false,
    icon = null,
    children,
    badge = false,
    badge2,
    small = false,
    className,
    ...otherProps
  }: ItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/d5612535 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] px-3.5 py-0.5",
        {
          "h-7 rounded-[8px] px-2.5": small,
          "bg-default-background px-2.5 pb-px shadow-sm": active,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "text-body-1 font-body-1 text-subtext-color group-hover/d5612535:text-default-font",
            {
              "text-body-2 font-body-2": small,
              "text-neutral-400 group-hover/d5612535:text-neutral-400":
                disabled,
              "text-brand-600 group-hover/d5612535:text-brand-600": active,
            }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-body-2-bold font-body-2-bold text-neutral-700 group-hover/d5612535:text-default-font",
            {
              "text-button-xs font-button-xs": small,
              "text-neutral-400 group-hover/d5612535:text-neutral-400":
                disabled,
              "text-neutral-900": active,
            }
          )}
        >
          {children}
        </span>
      ) : null}
      {badge2 ? (
        <div className="flex items-center justify-center gap-2">{badge2}</div>
      ) : null}
    </div>
  );
});

export interface TabsRootProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  small?: boolean;
  className?: string;
}

const TabsRoot = React.forwardRef<HTMLDivElement, TabsRootProps>(
  function TabsRoot(
    { children, small = false, className, ...otherProps }: TabsRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/e1ad5091 flex w-full items-end rounded-xl bg-alpha-slate-8 px-1 py-1",
          { "rounded-[10px] px-0.5 py-0.5": small },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {children ? (
          <div className="flex items-start self-stretch">{children}</div>
        ) : null}
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-2 self-stretch border-b border-solid border-neutral-border" />
      </div>
    );
  }
);

export const Tabs = Object.assign(TabsRoot, {
  Item,
});
