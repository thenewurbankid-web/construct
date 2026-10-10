"use client";
/*
 * Documentation:
 * Side Nav — https://app.subframe.com/de62b029ca8b/library?component=Side+Nav_1e1b89cb-7b1a-480c-b8a8-c8eddb3c8c60
 */

import React from "react";
import { FeatherCircleDashed } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface NavItemProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  children?: React.ReactNode;
  selected?: boolean;
  rightSlot?: React.ReactNode;
  destructive?: boolean;
  showIndicator?: boolean;
  disabled?: boolean;
  collapsed?: boolean;
  className?: string;
}

const NavItem = React.forwardRef<HTMLDivElement, NavItemProps>(function NavItem(
  {
    icon = <FeatherCircleDashed />,
    children,
    selected = false,
    rightSlot,
    destructive = false,
    showIndicator = false,
    disabled = false,
    collapsed = false,
    className,
    ...otherProps
  }: NavItemProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/0c4c70a0 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-rounded-sm px-4 py-2 group/navitem hover:bg-alpha-slate-8",
        {
          "w-10 px-2": collapsed,
          "cursor-not-allowed hover:bg-transparent": disabled,
          "hover:bg-alpha-error-12": destructive,
          "bg-white-alt shadow-md hover:bg-white-alt": selected,
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {icon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[20px] font-[400] leading-[20px] tracking-[0.03em] text-neutral-700",
            {
              "text-neutral-400": disabled,
              "text-error-500": destructive,
              "text-accent-vivid-midnight": selected,
            }
          )}
        >
          {icon}
        </SubframeCore.IconWrapper>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "line-clamp-1 grow shrink-0 basis-0 text-caption font-caption text-neutral-700",
            {
              hidden: collapsed,
              "text-neutral-400": disabled,
              "text-error-500": destructive,
              "text-accent-vivid-midnight": selected,
            }
          )}
        >
          {children}
        </span>
      ) : null}
      {rightSlot ? <div className="flex items-center">{rightSlot}</div> : null}
      <div
        className={SubframeUtils.twClassNames("hidden items-center", {
          flex: showIndicator,
        })}
      >
        <div className="flex h-2 w-2 flex-none items-start rounded-full bg-error-500" />
      </div>
    </div>
  );
});

export interface NavSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  label?: React.ReactNode;
  className?: string;
}

const NavSection = React.forwardRef<HTMLDivElement, NavSectionProps>(
  function NavSection(
    { children, label, className, ...otherProps }: NavSectionProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-1 pb-7",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {label ? (
          <span className="w-full text-overline-xs-mono font-overline-xs-mono text-neutral-500 px-4 py-2 uppercase [.w-14_&]:hidden">
            {label}
          </span>
        ) : null}
        {children ? (
          <div className="flex w-full flex-col items-start gap-1">
            {children}
          </div>
        ) : null}
      </div>
    );
  }
);

export interface SideNavRootProps extends React.HTMLAttributes<HTMLElement> {
  header?: React.ReactNode;
  topMenu?: React.ReactNode;
  mainMenu?: React.ReactNode;
  bottomMenu?: React.ReactNode;
  collapsed?: boolean;
  className?: string;
}

const SideNavRoot = React.forwardRef<HTMLElement, SideNavRootProps>(
  function SideNavRoot(
    {
      header,
      topMenu,
      mainMenu,
      bottomMenu,
      collapsed = false,
      className,
      ...otherProps
    }: SideNavRootProps,
    ref
  ) {
    return (
      <nav
        className={SubframeUtils.twClassNames(
          "group/1e1b89cb flex h-full w-48 flex-col items-start gap-2 pl-2 pr-6 py-3",
          {
            "w-14 border-r border-y-0 border-l-0 border-solid border-alpha-slate-8 pr-2":
              collapsed,
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-start gap-3",
            { hidden: collapsed }
          )}
        >
          {header ? (
            <div className="flex h-16 w-full flex-none items-center gap-4 px-1.5">
              {header}
            </div>
          ) : null}
          <div className="flex h-px w-full flex-none items-start bg-neutral-200" />
        </div>
        {topMenu ? (
          <div className="flex w-full flex-col items-start gap-2 py-2">
            {topMenu}
          </div>
        ) : null}
        {mainMenu ? (
          <div className="flex w-full flex-col items-start gap-2">
            {mainMenu}
          </div>
        ) : null}
        {bottomMenu ? (
          <div className="flex w-full grow shrink-0 basis-0 flex-col items-start justify-end gap-1">
            {bottomMenu}
          </div>
        ) : null}
      </nav>
    );
  }
);

export const SideNav = Object.assign(SideNavRoot, {
  NavItem,
  NavSection,
});
