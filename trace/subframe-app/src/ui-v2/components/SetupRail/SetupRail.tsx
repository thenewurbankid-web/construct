"use client";
/*
 * Documentation:
 * Logo Mark — https://app.subframe.com/de62b029ca8b/library?component=Logo+Mark_f69f9752-0b93-4164-966a-e2ed9de62a1a
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 * SetupRail — https://app.subframe.com/de62b029ca8b/library?component=SetupRail_59d66b17-577e-483c-94b4-88155a26e115
 */

import React from "react";
import * as SubframeUtils from "../../utils";
import { LogoMark } from "../LogoMark";
import { MaxStates } from "../MaxStates";

export interface SetupRailRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  stepLabel?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

const SetupRailRoot = React.forwardRef<HTMLDivElement, SetupRailRootProps>(
  function SetupRailRoot(
    {
      stepLabel,
      title,
      description,
      className,
      ...otherProps
    }: SetupRailRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex h-full w-[400px] flex-col items-start overflow-hidden rounded-rounded-lg bg-cyan-200 relative mobile:hidden tablet:w-80",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-[560px] w-[540px] flex-none items-start rounded-full bg-fuchsia-300/30 blur-[90px] absolute left-[240px] top-[-260px]" />
        <div className="flex h-[560px] w-[540px] flex-none items-start rounded-full bg-cyan-100/70 blur-[90px] absolute left-[60px] top-[430px]" />
        <div className="flex h-[520px] w-[520px] flex-none items-start rounded-full border border-solid border-white/35 absolute left-[-30px] top-[430px]" />
        <div className="flex h-[440px] w-[440px] flex-none items-start rounded-full border border-solid border-white/40 absolute left-1/2 -translate-x-1/2 top-[470px]" />
        <MaxStates className="h-[420px] w-[420px] flex-none absolute bottom-[-205px] left-1/2 -translate-x-1/2" />
        <div className="flex w-full flex-col items-start gap-6 px-12 pt-12 relative z-10">
          <LogoMark className="h-[55px] w-[157px] flex-none" />
          <div className="flex w-full flex-col items-start gap-3 mt-16">
            {stepLabel ? (
              <span className="text-subtitle-2 font-subtitle-2 text-accent-vivid-indigo">
                {stepLabel}
              </span>
            ) : null}
            {title ? (
              <span className="w-full text-h3 font-h3 text-neutral-900">
                {title}
              </span>
            ) : null}
            {description ? (
              <span className="w-full text-body-2 font-body-2 text-neutral-600">
                {description}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

export const SetupRail = SetupRailRoot;
