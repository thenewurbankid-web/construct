"use client";
/*
 * Documentation:
 * Feature Icon — https://app.subframe.com/de62b029ca8b/library?component=Feature+Icon_4e1f81be-2060-425c-af29-81c1876c6e72
 * MetricCard — https://app.subframe.com/de62b029ca8b/library?component=MetricCard_b262c036-17e7-4c43-a745-99289641f99c
 */

import React from "react";
import { FeatherArrowDown } from "@subframe/core";
import { FeatherArrowUp } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherClock } from "@subframe/core";
import { FeatherInfo } from "@subframe/core";
import { FeatherMinus } from "@subframe/core";
import { FeatherWallet } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { FeatureIcon } from "../FeatureIcon";

export interface HeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  naming?: "overline" | "title";
  label?: React.ReactNode;
  metaLabel?: React.ReactNode;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  featuredIcon?: boolean;
  className?: string;
}

const Header = React.forwardRef<HTMLDivElement, HeaderProps>(function Header(
  {
    naming = "overline",
    label,
    metaLabel,
    leadingIcon = <FeatherWallet />,
    trailingIcon = null,
    featuredIcon = false,
    className,
    ...otherProps
  }: HeaderProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/a3f5e721 flex w-full items-center gap-3 group/a1header",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <FeatureIcon
        className={SubframeUtils.twClassNames("hidden", { flex: featuredIcon })}
        icon={leadingIcon}
        size="xs"
      />
      <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start">
        {label ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-caption-mono font-caption-mono text-neutral-900 uppercase",
              {
                "text-subtitle-1 font-subtitle-1 text-default-font normal-case":
                  naming === "title",
              }
            )}
          >
            {label}
          </span>
        ) : null}
        {metaLabel ? (
          <span className="text-caption font-caption text-subtext-color">
            {metaLabel}
          </span>
        ) : null}
      </div>
      {trailingIcon ? (
        <SubframeCore.IconWrapper
          className={SubframeUtils.twClassNames(
            "text-body-1 font-body-1 text-neutral-500",
            { "text-h6 font-h6": naming === "title" }
          )}
        >
          {trailingIcon}
        </SubframeCore.IconWrapper>
      ) : null}
    </div>
  );
});

export interface ValueProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "prefix"> {
  size?: "display" | "default" | "compact";
  tone?: "default" | "success" | "warning" | "error" | "info" | "on-emphasis";
  prefix?: React.ReactNode;
  children?: React.ReactNode;
  suffix?: React.ReactNode;
  className?: string;
}

const Value = React.forwardRef<HTMLDivElement, ValueProps>(function Value(
  {
    size = "default",
    tone = "default",
    prefix,
    children,
    suffix,
    className,
    ...otherProps
  }: ValueProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/73757bfc flex w-full items-end gap-1 group/a1value",
        { "gap-0.5": size === "compact" },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {prefix ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-subtitle-1-max font-subtitle-1-max text-default-font self-start pt-1",
            {
              "text-white": tone === "on-emphasis",
              "text-blue-600": tone === "info",
              "text-error-600": tone === "error",
              "text-warning-600": tone === "warning",
              "text-success-600": tone === "success",
              "text-caption-max font-caption-max pt-0.5": size === "compact",
              "text-h5-max font-h5-max pt-1.5": size === "display",
            }
          )}
        >
          {prefix}
        </span>
      ) : null}
      {children ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-h3-max font-h3-max text-default-font",
            {
              "text-white": tone === "on-emphasis",
              "text-blue-600": tone === "info",
              "text-error-600": tone === "error",
              "text-warning-600": tone === "warning",
              "text-success-600": tone === "success",
              "text-h5-max font-h5-max": size === "compact",
              "text-h2-max font-h2-max": size === "display",
            }
          )}
        >
          {children}
        </span>
      ) : null}
      {suffix ? (
        <span
          className={SubframeUtils.twClassNames(
            "text-subtitle-1-max font-subtitle-1-max text-default-font self-end pb-0.5",
            {
              "text-white": tone === "on-emphasis",
              "text-blue-600": tone === "info",
              "text-error-600": tone === "error",
              "text-warning-600": tone === "warning",
              "text-success-600": tone === "success",
              "text-caption-max font-caption-max pb-0": size === "compact",
              "text-h5-max font-h5-max pb-1": size === "display",
            }
          )}
        >
          {suffix}
        </span>
      ) : null}
    </div>
  );
});

export interface DeltaProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: "up" | "down" | "flat";
  tone?: "positive" | "negative" | "neutral" | "on-emphasis";
  children?: React.ReactNode;
  comparisonText?: React.ReactNode;
  surface?: "plain" | "chip";
  className?: string;
}

const Delta = React.forwardRef<HTMLDivElement, DeltaProps>(function Delta(
  {
    direction = "up",
    tone = "positive",
    children,
    comparisonText,
    surface = "plain",
    className,
    ...otherProps
  }: DeltaProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/d8074924 flex w-full items-center gap-2 group/a1delta",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div
        className={SubframeUtils.twClassNames("flex items-center gap-0.5", {
          "rounded-rounded-xs bg-white px-2 py-1": surface === "chip",
        })}
      >
        {direction === "flat" ? (
          <FeatherMinus
            className={SubframeUtils.twClassNames(
              "font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-success-600",
              {
                "text-white": tone === "on-emphasis",
                "text-neutral-600": tone === "neutral",
                "text-error-600": tone === "negative",
              }
            )}
          />
        ) : direction === "down" ? (
          <FeatherArrowDown
            className={SubframeUtils.twClassNames(
              "font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-success-600",
              {
                "text-white": tone === "on-emphasis",
                "text-neutral-600": tone === "neutral",
                "text-error-600": tone === "negative",
              }
            )}
          />
        ) : (
          <FeatherArrowUp
            className={SubframeUtils.twClassNames(
              "font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-success-600",
              {
                "text-white": tone === "on-emphasis",
                "text-neutral-600": tone === "neutral",
                "text-error-600": tone === "negative",
              }
            )}
          />
        )}
        {children ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-body-2 font-body-2 text-success-600",
              {
                "text-white": tone === "on-emphasis",
                "text-neutral-600": tone === "neutral",
                "text-error-600": tone === "negative",
              }
            )}
          >
            {children}
          </span>
        ) : null}
      </div>
      {comparisonText ? (
        <span className="text-caption font-caption text-neutral-500">
          {comparisonText}
        </span>
      ) : null}
    </div>
  );
});

export interface NarrativeProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  surface?: "plain" | "inset";
  showChevron?: boolean;
  className?: string;
}

const Narrative = React.forwardRef<HTMLDivElement, NarrativeProps>(
  function Narrative(
    {
      children,
      surface = "plain",
      showChevron = false,
      className,
      ...otherProps
    }: NarrativeProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/918a6229 flex w-full items-center gap-3",
          {
            "rounded-rounded-sm bg-neutral-100 px-3 py-3": surface === "inset",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {children ? (
          <span className="grow shrink-0 basis-0 text-caption font-caption text-neutral-600">
            {children}
          </span>
        ) : null}
        <FeatherChevronRight
          className={SubframeUtils.twClassNames(
            "hidden font-['Inter_Tight'] text-[16px] font-[400] leading-[16px] text-neutral-500 flex-none",
            { "inline-flex": showChevron }
          )}
        />
      </div>
    );
  }
);

export interface ProvenanceProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
  freshness?: "current" | "stale" | "unknown";
  className?: string;
}

const Provenance = React.forwardRef<HTMLDivElement, ProvenanceProps>(
  function Provenance(
    {
      children,
      freshness = "current",
      className,
      ...otherProps
    }: ProvenanceProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/3999eef3 flex w-full items-center gap-1 border-t border-solid border-alpha-slate-8 pt-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <FeatherClock
          className={SubframeUtils.twClassNames(
            "hidden font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-warning-600",
            { "inline-flex": freshness === "stale" }
          )}
        />
        <FeatherInfo
          className={SubframeUtils.twClassNames(
            "hidden font-['Inter_Tight'] text-[12px] font-[400] leading-[12px] text-neutral-500",
            { "inline-flex": freshness === "unknown" }
          )}
        />
        {children ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-caption-xs-mono font-caption-xs-mono text-neutral-500",
              { "text-warning-600": freshness === "stale" }
            )}
          >
            {children}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface MetricCardRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  density?: "default" | "compact";
  state?: "default" | "loading" | "nodata" | "error";
  flow?: "vertical" | "horizontal";
  visualizationSlot?: React.ReactNode;
  actionSlot?: React.ReactNode;
  errorMessage?: React.ReactNode;
  nodataMessage?: React.ReactNode;
  children?: React.ReactNode;
  showNew?: boolean;
  headerSlot?: React.ReactNode;
  hideFigure?: boolean;
  narrativeSlot?: React.ReactNode;
  provenanceSlot?: React.ReactNode;
  showProvenanceSlot?: boolean;
  showActionSlot?: boolean;
  className?: string;
}

const MetricCardRoot = React.forwardRef<HTMLDivElement, MetricCardRootProps>(
  function MetricCardRoot(
    {
      density = "default",
      state = "default",
      flow = "vertical",
      visualizationSlot,
      actionSlot,
      errorMessage,
      nodataMessage,
      children,
      showNew = false,
      headerSlot,
      hideFigure = false,
      narrativeSlot,
      provenanceSlot,
      showProvenanceSlot = false,
      showActionSlot = false,
      className,
      ...otherProps
    }: MetricCardRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/b262c036 flex w-full flex-col items-start gap-3 rounded-rounded-md border border-solid border-alpha-slate-12 bg-default-background px-6 py-6 relative mobile:px-4 mobile:py-4",
          { "gap-2 px-4 py-4": density === "compact" },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "hidden h-2 w-2 flex-none items-start rounded-full bg-accent-vivid-fuchsia absolute right-2.5 top-2.5",
            { flex: showNew }
          )}
        />
        {headerSlot ? (
          <div
            className={SubframeUtils.twClassNames(
              "flex min-h-[40px] w-full items-center",
              { "min-h-[24px] flex-none": density === "compact" }
            )}
          >
            {headerSlot}
          </div>
        ) : null}
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-start gap-1.5",
            { "flex-row": flow === "horizontal" }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1.5",
              { hidden: hideFigure }
            )}
          >
            {children ? (
              <div
                className={SubframeUtils.twClassNames(
                  "flex w-full flex-col items-start gap-1",
                  {
                    hidden:
                      state === "error" ||
                      state === "nodata" ||
                      state === "loading",
                  }
                )}
              >
                {children}
              </div>
            ) : null}
            <div
              className={SubframeUtils.twClassNames(
                "hidden h-10 w-full flex-none items-start rounded-rounded-sm bg-neutral-200 animate-pulse",
                { flex: state === "loading" }
              )}
            />
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full flex-col items-start gap-1.5",
                { flex: state === "nodata" }
              )}
            >
              <span className="text-h3-max font-h3-max text-neutral-500">
                —
              </span>
              {nodataMessage ? (
                <span className="text-body-2 font-body-2 text-neutral-500">
                  {nodataMessage}
                </span>
              ) : null}
            </div>
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full flex-col items-start gap-1.5",
                { flex: state === "error" }
              )}
            >
              <span className="text-h3-max font-h3-max text-neutral-500">
                —
              </span>
              {errorMessage ? (
                <span className="text-body-2 font-body-2 text-error-600">
                  {errorMessage}
                </span>
              ) : null}
            </div>
          </div>
          {visualizationSlot ? (
            <div className="flex w-full min-w-[0px] grow shrink-0 basis-0 flex-col items-start">
              {visualizationSlot}
            </div>
          ) : null}
        </div>
        <div className="flex min-h-[1px] w-full grow shrink-0 basis-0 items-start" />
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-start",
            { hidden: state === "error" || state === "loading" }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex w-full flex-col items-start gap-4",
              { "gap-3": density === "compact" }
            )}
          >
            {narrativeSlot ? (
              <div className="flex w-full flex-col items-start">
                {narrativeSlot}
              </div>
            ) : null}
            {provenanceSlot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full flex-col items-start",
                  { flex: showProvenanceSlot }
                )}
              >
                {provenanceSlot}
              </div>
            ) : null}
            {actionSlot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full items-center gap-3",
                  { flex: showActionSlot }
                )}
              >
                {actionSlot}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

export const MetricCard = Object.assign(MetricCardRoot, {
  Header,
  Value,
  Delta,
  Narrative,
  Provenance,
});
