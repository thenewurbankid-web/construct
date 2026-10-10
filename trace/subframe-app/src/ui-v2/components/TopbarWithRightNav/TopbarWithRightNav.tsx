"use client";
/*
 * Documentation:
 * Topbar with right nav — https://app.subframe.com/de62b029ca8b/library?component=Topbar+with+right+nav_d20e2e52-ba3d-4133-901a-9a15f7f729a9
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface NavItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

const NavItem = React.forwardRef<HTMLDivElement, NavItemProps>(function NavItem(
  {
    selected = false,
    icon = null,
    children,
    className,
    ...otherProps
  }: NavItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/79ff7d2b flex h-10 cursor-pointer items-center justify-center gap-2 rounded-rounded-sm px-3 py-1",
        { "bg-alpha-slate-12": selected },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "font-['Inter'] text-[16px] font-[600] leading-[20px] text-subtext-color group-hover/79ff7d2b:text-default-font",
            { "text-default-font": selected }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-body-2 font-body-2 text-subtext-color group-hover/79ff7d2b:text-default-font",
            { "text-body-2-bold font-body-2-bold text-default-font": selected }
          )}
        >
          {children}
        </span>
      ) : null}
    </div>
  );
});

export interface NewFeatureProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "content"> {
  content?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const NewFeature = React.forwardRef<HTMLDivElement, NewFeatureProps>(
  function NewFeature(
    { content, icon = null, className, ...otherProps }: NewFeatureProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex flex-col items-start gap-2 rounded-rounded-sm border-2 border-solid border-fuchsia-500",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-10 flex-none items-center justify-center gap-2 rounded-rounded-sm px-3 py-1">
          {icon ? (
            <SubframeCore.IconWrapper className="font-['Inter'] text-[16px] font-[600] leading-[20px] text-subtext-color">
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {content ? (
            <span className="text-body-2 font-body-2 text-subtext-color">
              {content}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
);

export interface TopbarWithRightNavRootProps
  extends React.HTMLAttributes<HTMLElement> {
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}

const TopbarWithRightNavRoot = React.forwardRef<
  HTMLElement,
  TopbarWithRightNavRootProps
>(function TopbarWithRightNavRoot(
  {
    leftSlot,
    rightSlot,
    className,
    ...otherProps
  }: TopbarWithRightNavRootProps,
  ref
) {
  return (
    <nav
      className={SubframeUtils.twClassNames(
        "flex w-full items-center gap-4 px-6 py-4 max-w-[1920px]",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {leftSlot ? (
        <div className="flex h-8 items-center gap-2">{leftSlot}</div>
      ) : null}
      {rightSlot ? (
        <div className="flex grow shrink-0 basis-0 items-center justify-end gap-4">
          {rightSlot}
        </div>
      ) : null}
    </nav>
  );
});

export const TopbarWithRightNav = Object.assign(TopbarWithRightNavRoot, {
  NavItem,
  NewFeature,
});
