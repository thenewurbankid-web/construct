"use client";
/*
 * Documentation:
 * AuthStatePanel — https://app.subframe.com/de62b029ca8b/library?component=AuthStatePanel_6a48bf93-86f7-4048-9cd4-ab542001e853
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { Button } from "../Button";

export interface AuthStatePanelRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  hideMark?: boolean;
  hideEyebrow?: boolean;
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  showContent?: boolean;
  children?: React.ReactNode;
  hideActions?: boolean;
  primaryAction?: React.ReactNode;
  hideSecondaryAction?: boolean;
  secondaryAction?: React.ReactNode;
  hideSupportNote?: boolean;
  supportNote?: React.ReactNode;
  className?: string;
}

const AuthStatePanelRoot = React.forwardRef<
  HTMLDivElement,
  AuthStatePanelRootProps
>(function AuthStatePanelRoot(
  {
    hideMark = false,
    hideEyebrow = false,
    eyebrow,
    title,
    body,
    showContent = false,
    children,
    hideActions = false,
    primaryAction,
    hideSecondaryAction = false,
    secondaryAction,
    hideSupportNote = false,
    supportNote,
    className,
    ...otherProps
  }: AuthStatePanelRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/6a48bf93 flex h-full w-[520px] flex-col items-start gap-8 px-7 pt-10 pb-6 mobile:gap-6 mobile:px-3 mobile:pt-6 mobile:pb-4 tablet:w-full tablet:max-w-[520px]",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full flex-col items-start gap-4 pt-4">
        <svg
          className={SubframeUtils.twClassNames(
            "font-['Inter_Tight'] text-[40px] font-[400] leading-[60px] text-default-font inline h-10 w-10 flex-none",
            { hidden: hideMark }
          )}
          width="1em"
          height="1em"
          viewBox="0 0 40 40"
        >
          <path
            d="M5 34V22c0-9.39 6.72-17 15-17s15 7.61 15 17v12"
            fill="none"
            stroke="rgb(74 0 248)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="miter"
          />
          <path
            d="M11 34V22.5c0-6.35 4.03-11.5 9-11.5s9 5.15 9 11.5V34"
            fill="none"
            stroke="rgb(74 0 248)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="miter"
          />
          <path
            d="M17 34V23c0-2.21 1.34-4 3-4s3 1.79 3 4v6h-6"
            fill="none"
            stroke="rgb(74 0 248)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex w-full flex-col items-start gap-3">
          {eyebrow ? (
            <span
              className={SubframeUtils.twClassNames(
                "text-subtitle-2 font-subtitle-2 text-accent-vivid-indigo",
                { hidden: hideEyebrow }
              )}
            >
              {eyebrow}
            </span>
          ) : null}
          {title ? (
            <span className="w-full text-h3 font-h3 text-neutral-900">
              {title}
            </span>
          ) : null}
          {body ? (
            <span className="w-full text-body-1 font-body-1 text-neutral-600">
              {body}
            </span>
          ) : null}
        </div>
      </div>
      {children ? (
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full flex-col items-start gap-4",
            { flex: showContent }
          )}
        >
          {children}
        </div>
      ) : null}
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-4",
          { hidden: hideActions }
        )}
      >
        <Button className="h-12 w-full flex-none" variant="primary">
          {primaryAction}
        </Button>
        {secondaryAction ? (
          <span
            className={SubframeUtils.twClassNames(
              "w-full text-body-1 font-body-1 text-accent-vivid-indigo text-center cursor-pointer",
              { hidden: hideSecondaryAction }
            )}
          >
            {secondaryAction}
          </span>
        ) : null}
      </div>
      <div className="flex w-full grow shrink-0 basis-0 items-start mobile:hidden" />
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-6 border-t border-solid border-neutral-300 pt-6",
          { hidden: hideSupportNote }
        )}
      >
        {supportNote ? (
          <span className="w-full text-body-2 font-body-2 text-neutral-600">
            {supportNote}
          </span>
        ) : null}
      </div>
    </div>
  );
});

export const AuthStatePanel = AuthStatePanelRoot;
