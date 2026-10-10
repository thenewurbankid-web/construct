"use client";
/*
 * Documentation:
 * Page Nav — https://app.subframe.com/de62b029ca8b/library?component=Page+Nav_d4c23ace-8465-4230-8afb-3374f6316e87
 */

import React from "react";
import { FeatherArrowRight } from "@subframe/core";
import { FeatherTarget } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface PageNavRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "slot"> {
  state?: "default" | "hover" | "active" | "disabled";
  ai?: boolean;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  hideLeftIcon?: boolean;
  rightIcon?: React.ReactNode;
  showRightIcon?: boolean;
  badge?: React.ReactNode;
  showBadge?: boolean;
  showIndicator?: boolean;
  slot?: React.ReactNode;
  numbering?: React.ReactNode;
  showNumbering?: boolean;
  className?: string;
}

const PageNavRoot = React.forwardRef<HTMLDivElement, PageNavRootProps>(
  function PageNavRoot(
    {
      state = "default",
      ai = false,
      label,
      icon = <FeatherTarget />,
      hideLeftIcon = false,
      rightIcon = <FeatherArrowRight />,
      showRightIcon = false,
      badge,
      showBadge = false,
      showIndicator = false,
      slot,
      numbering,
      showNumbering = false,
      className,
      ...otherProps
    }: PageNavRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/d4c23ace flex h-12 w-full min-w-[100px] cursor-pointer items-center gap-3 overflow-hidden rounded-rounded-md relative hover:bg-alpha-slate-4",
          {
            "cursor-not-allowed [&:has(>.z-0.flex)]:opacity-55 hover:bg-transparent":
              state === "disabled",
            "bg-bg-white shadow-sm hover:bg-bg-white": state === "active",
            "bg-alpha-slate-4": state === "hover",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-start rounded-rounded-md absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,var(--color-alpha-fuchsia-16),transparent_55%),radial-gradient(circle_at_0%_100%,var(--color-alpha-aqua-16),transparent_55%)] z-0",
            { flex: ai, "opacity-0": state === "disabled" }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "hidden items-start rounded-rounded-md px-px py-px absolute inset-0 bg-[linear-gradient(90deg,var(--color-pink-500),var(--color-brand-400)_35%,var(--color-cyan-400)_65%,transparent_95%)] [mask-image:linear-gradient(#000,#000),linear-gradient(#000,#000)] [mask-clip:content-box,border-box] [mask-composite:exclude] z-0",
            { flex: ai, "opacity-0": state === "disabled" }
          )}
        />
        <div className="flex min-w-[0px] grow shrink-0 basis-0 items-center gap-2 px-5 py-3.5 relative z-10">
          {icon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "font-['Inter_Tight'] text-[20px] font-[400] leading-[20px] text-neutral-500 inline",
                {
                  hidden: hideLeftIcon,
                  "text-neutral-400": state === "disabled",
                  "text-neutral-800": state === "active",
                }
              )}
            >
              {icon}
            </SubframeCore.IconWrapper>
          ) : null}
          {numbering ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden w-6 flex-none text-body-2-mono font-body-2-mono text-neutral-600 text-right",
                {
                  block: showNumbering,
                  "text-neutral-400": state === "disabled",
                }
              )}
            >
              {numbering}
            </span>
          ) : null}
          {label ? (
            <span
              className={SubframeUtils.twClassNames(
                "grow shrink-0 basis-0 whitespace-nowrap text-button font-button text-neutral-900",
                {
                  "text-neutral-400": state === "disabled",
                  "text-neutral-800": state === "active",
                }
              )}
            >
              {label}
            </span>
          ) : null}
          {slot ? (
            <div
              className={SubframeUtils.twClassNames("hidden items-center", {
                flex: showBadge,
              })}
            >
              {slot}
            </div>
          ) : null}
          {rightIcon ? (
            <SubframeCore.IconWrapper
              className={SubframeUtils.twClassNames(
                "hidden font-['Inter_Tight'] text-[20px] font-[400] leading-[20px] text-neutral-500",
                {
                  inline: showRightIcon,
                  "text-neutral-400": state === "disabled",
                  "text-neutral-800": state === "active",
                }
              )}
            >
              {rightIcon}
            </SubframeCore.IconWrapper>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-1.5 w-1.5 flex-none items-start rounded-full bg-fuchsia-500 absolute top-[2px] right-[2px] z-20",
            { flex: showIndicator }
          )}
        />
      </div>
    );
  }
);

export const PageNav = PageNavRoot;
