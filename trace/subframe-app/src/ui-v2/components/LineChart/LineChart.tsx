"use client";
/*
 * Documentation:
 * Line Chart — https://app.subframe.com/de62b029ca8b/library?component=Line+Chart_22944dd2-3cdd-42fd-913a-1b11a3c1d16d
 */

import React from "react";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";

export interface LineChartRootProps
  extends React.ComponentProps<typeof SubframeCore.LineChart> {
  className?: string;
}

const LineChartRoot = React.forwardRef<
  React.ElementRef<typeof SubframeCore.LineChart>,
  LineChartRootProps
>(function LineChartRoot(
  { className, ...otherProps }: LineChartRootProps,
  ref
) {
  return (
    <SubframeCore.LineChart
      className={SubframeUtils.twClassNames("h-80 w-full", className)}
      ref={ref}
      colors={[
        "#682af9",
        "#c2aafc",
        "#4a00f8",
        "#a47ffb",
        "#3d00ce",
        "#8655fa",
      ]}
      {...otherProps}
    />
  );
});

export const LineChart = LineChartRoot;
