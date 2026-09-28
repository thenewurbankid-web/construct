"use client";
/*
 * Documentation:
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 * Page Layout — https://app.subframe.com/de62b029ca8b/library?component=Page+Layout_bade8d08-9877-4b7c-9164-568733ed476b
 */

import React from "react";
import { FeatherX } from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { IconButton } from "../IconButton";

export interface PageLayoutRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "with-pane" | "blank" | "conversation";
  children?: React.ReactNode;
  commandInput?: React.ReactNode;
  sidebar?: React.ReactNode;
  commandInputExpanded?: boolean;
  header?: React.ReactNode;
  className?: string;
}

const PageLayoutRoot = React.forwardRef<HTMLDivElement, PageLayoutRootProps>(
  function PageLayoutRoot(
    {
      variant = "with-pane",
      children,
      commandInput,
      sidebar,
      commandInputExpanded = false,
      header,
      className,
      ...otherProps
    }: PageLayoutRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/bade8d08 flex w-full gap-1.5 overflow-hidden bg-bg-01 px-2 py-2 h-dvh items-stretch relative mobile:gap-0 mobile:px-0 mobile:py-0",
          { "gap-0 px-0 py-0": variant === "blank" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {sidebar ? (
          <div
            className={SubframeUtils.twClassNames(
              "flex min-h-[0px] self-stretch overflow-hidden items-stretch mobile:hidden",
              { hidden: variant === "blank" }
            )}
          >
            {sidebar}
          </div>
        ) : null}
        <div
          className={SubframeUtils.twClassNames(
            "flex min-h-[0px] min-w-[0px] grow shrink-0 basis-0 flex-col items-center self-stretch border-l border-solid border-neutral-200 relative",
            {
              "border-solid border-neutral-200 border-l-0": variant === "blank",
            }
          )}
        >
          {header ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex w-full max-w-[1280px] items-center gap-5 px-4 py-4 mobile:gap-2 mobile:px-3",
                { hidden: variant === "blank" }
              )}
            >
              {header}
            </div>
          ) : null}
          <div className="flex min-h-[0px] w-full grow shrink-0 basis-0 items-start justify-center overflow-y-auto overflow-x-hidden overscroll-y-contain relative">
            {children ? (
              <div
                className={SubframeUtils.twClassNames(
                  "flex min-w-[0px] max-w-[1280px] grow shrink-0 basis-0 flex-col items-center",
                  { "max-w-none": variant === "blank" }
                )}
              >
                {children}
              </div>
            ) : null}
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "flex h-48 flex-none items-start pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg-01 to-transparent transition-opacity duration-300 z-40 opacity-0",
              {
                "opacity-100": commandInputExpanded,
                hidden: variant === "blank",
              }
            )}
          />
          {commandInput ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex w-full max-w-[576px] flex-col items-center pt-2 pb-4 absolute bottom-0 left-1/2 -translate-x-1/2 z-50 mobile:px-4",
                { hidden: variant === "blank" }
              )}
            >
              {commandInput}
            </div>
          ) : null}
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden min-h-[0px] w-80 flex-none flex-col self-stretch rounded-rounded-sm border border-solid border-alpha-slate-8 bg-default-background items-stretch overflow-y-auto overflow-x-hidden overscroll-y-contain",
            { "flex mobile:hidden": variant === "conversation" }
          )}
        >
          <div className="flex w-full items-center justify-between pl-4 pr-1 py-3">
            <span className="text-overline-xs font-overline-xs text-neutral-500 uppercase tracking-[2px]">
              RECENT CONVERSATIONS
            </span>
            <IconButton variant="outline" size="xsmall" icon={<FeatherX />} />
          </div>
        </div>
      </div>
    );
  }
);

export const PageLayout = PageLayoutRoot;
