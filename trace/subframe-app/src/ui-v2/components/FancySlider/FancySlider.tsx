"use client";
/*
 * Documentation:
 * Fancy Slider — https://app.subframe.com/de62b029ca8b/library?component=Fancy+Slider_882b8048-df97-4d94-a729-b2ba6c093a33
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface RangeProps
  extends React.ComponentProps<typeof SubframeCore.Slider.Range> {
  className?: string;
}

const Range = React.forwardRef<HTMLDivElement, RangeProps>(function Range(
  { className, ...otherProps }: RangeProps,
  ref
) {
  return (
    <SubframeCore.Slider.Range asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "flex h-full flex-col items-start rounded-full bg-brand-500",
          className
        )}
        ref={ref}
      />
    </SubframeCore.Slider.Range>
  );
});

export interface ThumbProps
  extends React.ComponentProps<typeof SubframeCore.Slider.Thumb> {
  className?: string;
}

const Thumb = React.forwardRef<HTMLDivElement, ThumbProps>(function Thumb(
  { className, ...otherProps }: ThumbProps,
  ref
) {
  return (
    <SubframeCore.Slider.Thumb asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "group/0905a8c5 flex h-7 w-7 cursor-pointer items-center justify-center gap-2 rounded-full bg-white shadow-elevation---01 hover:h-8 hover:w-8",
          className
        )}
        ref={ref}
      >
        <div className="flex h-6 w-6 flex-none items-center justify-center gap-2 rounded-full bg-brand-500 group-hover/0905a8c5:h-7 group-hover/0905a8c5:w-7">
          <div className="flex h-4 w-4 flex-none items-center gap-2 rounded-full bg-default-background shadow-md group-hover/0905a8c5:h-5 group-hover/0905a8c5:w-5 group-active/0905a8c5:h-3 group-active/0905a8c5:w-3" />
        </div>
      </div>
    </SubframeCore.Slider.Thumb>
  );
});

export interface TrackProps
  extends React.ComponentProps<typeof SubframeCore.Slider.Track> {
  className?: string;
}

const Track = React.forwardRef<HTMLDivElement, TrackProps>(function Track(
  { className, ...otherProps }: TrackProps,
  ref
) {
  return (
    <SubframeCore.Slider.Track asChild={true} {...otherProps}>
      <div
        className={SubframeUtils.twClassNames(
          "flex h-1 w-full flex-col items-start gap-2 rounded-full bg-neutral-100",
          className
        )}
        ref={ref}
      >
        <FancySlider.Range />
      </div>
    </SubframeCore.Slider.Track>
  );
});

export interface MarkersProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

const Markers = React.forwardRef<HTMLDivElement, MarkersProps>(function Markers(
  { className, ...otherProps }: MarkersProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "flex w-full items-end justify-between",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex h-2 w-px flex-none flex-col items-center gap-2 rounded-full bg-neutral-300" />
      <div className="flex h-2 w-px flex-none flex-col items-center gap-2 rounded-full bg-neutral-300" />
      <div className="flex h-2 w-px flex-none flex-col items-center gap-2 rounded-full bg-neutral-300" />
    </div>
  );
});

export interface FancySliderRootProps
  extends React.ComponentProps<typeof SubframeCore.Slider.Root> {
  markers?: boolean;
  value?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  className?: string;
}

const FancySliderRoot = React.forwardRef<HTMLDivElement, FancySliderRootProps>(
  function FancySliderRoot(
    { markers = false, className, ...otherProps }: FancySliderRootProps,
    ref
  ) {
    return (
      <SubframeCore.Slider.Root asChild={true} {...otherProps}>
        <div
          className={SubframeUtils.twClassNames(
            "group/882b8048 flex w-full cursor-pointer flex-col items-start gap-1",
            className
          )}
          ref={ref}
        >
          <div
            className={SubframeUtils.twClassNames(
              "hidden w-full flex-col items-end gap-2",
              { flex: markers }
            )}
          >
            <Markers />
          </div>
          <div className="flex h-5 w-full flex-none flex-col items-start justify-center gap-2">
            <Track />
            <Thumb />
          </div>
        </div>
      </SubframeCore.Slider.Root>
    );
  }
);

export const FancySlider = Object.assign(FancySliderRoot, {
  Range,
  Thumb,
  Track,
  Markers,
});
