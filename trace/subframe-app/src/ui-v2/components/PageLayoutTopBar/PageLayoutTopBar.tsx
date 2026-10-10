"use client";
/*
 * Documentation:
 * Page Layout - top bar — https://app.subframe.com/de62b029ca8b/library?component=Page+Layout+-+top+bar_cd3310d7-54c1-4d72-9b12-5ba83a51382c
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface PageLayoutTopBarRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  leftPane?: boolean;
  leftPaneSlot?: React.ReactNode;
  rightPaneSlot?: React.ReactNode;
  commandInput?: React.ReactNode;
  header?: React.ReactNode;
  rightPane?: boolean;
  sideNav?: React.ReactNode;
  className?: string;
}

const PageLayoutTopBarRoot = React.forwardRef<
  HTMLDivElement,
  PageLayoutTopBarRootProps
>(function PageLayoutTopBarRoot(
  {
    children,
    leftPane = false,
    leftPaneSlot,
    rightPaneSlot,
    commandInput,
    header,
    rightPane = false,
    sideNav,
    className,
    ...otherProps
  }: PageLayoutTopBarRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/cd3310d7 flex w-full bg-bg-01 items-stretch relative",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {sideNav ? <div className="flex items-stretch">{sideNav}</div> : null}
      <div className="flex grow shrink-0 basis-0 flex-col items-start self-stretch relative">
        {header ? (
          <div className="flex w-full justify-center items-stretch sticky top-0 z-[70] backdrop-blur-md">
            {header}
          </div>
        ) : null}
        <div className="flex w-full grow shrink-0 basis-0 items-start z-10 relative">
          <div className="flex min-w-[0px] grow shrink-0 basis-0 self-stretch items-stretch">
            {leftPaneSlot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden min-h-[0px] w-64 flex-none flex-col items-start self-stretch px-2 py-3 overflow-y-auto overflow-x-hidden overscroll-y-contain",
                  { flex: leftPane }
                )}
              >
                {leftPaneSlot}
              </div>
            ) : null}
            {children ? (
              <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-center px-6 mobile:px-2">
                {children}
              </div>
            ) : null}
            {rightPaneSlot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden min-h-[0px] w-80 flex-none flex-col self-stretch rounded-rounded-sm border-l border-solid border-alpha-slate-8 bg-default-background px-2 py-2 items-stretch overflow-y-auto overflow-x-hidden overscroll-y-contain",
                  { flex: rightPane }
                )}
              >
                {rightPaneSlot}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex h-48 flex-none items-start pointer-events-none fixed inset-x-0 bottom-0 bg-gradient-to-t from-bg-01 to-transparent z-[75] opacity-0" />
        <div className="flex w-full flex-col items-center px-10 pt-2 pb-4 max-w-[720px] fixed bottom-0 left-[calc(50%+96px)] -translate-x-1/2 z-[80] pointer-events-none mobile:px-4 mobile:max-w-[720px] mobile:fixed mobile:bottom-0 mobile:-translate-x-1/2 mobile:z-[80] mobile:pointer-events-none mobile:left-1/2">
          {commandInput ? (
            <div className="flex w-full flex-col items-center pointer-events-auto">
              {commandInput}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export const PageLayoutTopBar = PageLayoutTopBarRoot;
