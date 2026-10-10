"use client";
/*
 * Documentation:
 * Setting Row — https://app.subframe.com/de62b029ca8b/library?component=Setting+Row_cfa352a0-7e00-4507-bc7c-4df6d469f268
 */

import React from "react";
import * as SubframeUtils from "../../utils";

export interface SettingRowRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
  hideDescription?: boolean;
  leading?: React.ReactNode;
  control?: React.ReactNode;
  note?: React.ReactNode;
  hideDivider?: boolean;
  className?: string;
}

const SettingRowRoot = React.forwardRef<HTMLDivElement, SettingRowRootProps>(
  function SettingRowRoot(
    {
      label,
      description,
      hideDescription = false,
      leading,
      control,
      note,
      hideDivider = false,
      className,
      ...otherProps
    }: SettingRowRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/cfa352a0 flex min-h-[68px] w-full items-center justify-between border-b border-solid border-neutral-200 py-4 group/settingrow gap-6 mobile:flex-col mobile:items-start mobile:justify-start mobile:gap-3",
          { "min-h-[36px] border-none px-0 py-0": hideDivider },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex min-w-[0px] grow shrink-0 basis-0 items-center gap-3 mobile:min-w-0 mobile:flex-none">
          {leading ? <div className="flex items-center">{leading}</div> : null}
          <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1">
            {label ? (
              <span className="text-subtitle-2 font-subtitle-2 text-neutral-700">
                {label}
              </span>
            ) : null}
            {description ? (
              <span
                className={SubframeUtils.twClassNames(
                  "max-w-[400px] text-caption font-caption text-neutral-600",
                  { hidden: hideDescription }
                )}
              >
                {description}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 max-w-[55%] mobile:w-full mobile:flex-none mobile:items-start mobile:max-w-full">
          {control ? (
            <div className="flex items-center justify-end">{control}</div>
          ) : null}
          {note ? (
            <span className="max-w-[200px] text-caption font-caption text-neutral-600 text-right mobile:text-left mobile:max-w-full">
              {note}
            </span>
          ) : null}
        </div>
      </div>
    );
  }
);

export const SettingRow = SettingRowRoot;
