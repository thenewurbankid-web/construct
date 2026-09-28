"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Opportunity Card — https://app.subframe.com/de62b029ca8b/library?component=Opportunity+Card_5a0a6635-c956-41e7-8d92-ce9d77814752
 * Progress — https://app.subframe.com/de62b029ca8b/library?component=Progress_60964db0-a1bf-428b-b9d5-f34cdf58ea77
 */

import React from "react";
import { FeatherArrowDown } from "@subframe/core";
import { FeatherArrowRight } from "@subframe/core";
import { FeatherBadgeDollarSign } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherChevronRight } from "@subframe/core";
import { FeatherLeaf } from "@subframe/core";
import { FeatherLeafyGreen } from "@subframe/core";
import { FeatherShield } from "@subframe/core";
import { FeatherSparkles } from "@subframe/core";
import { FeatherTimer } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Progress } from "../Progress";

export interface OppTypeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "savings" | "esg" | "resilience";
  className?: string;
}

const OppType = React.forwardRef<HTMLDivElement, OppTypeProps>(function OppType(
  { variant = "savings", className, ...otherProps }: OppTypeProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/b6b47b27 flex items-center gap-1.5 rounded-b-rounded-xs px-4 py-2 bg-gradient-to-b from-brand-100 to-brand-25",
        {
          "from-orange-200 to-warning-50": variant === "resilience",
          "from-lemon-300 to-lemon-100": variant === "esg",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      {variant === "resilience" ? (
        <FeatherShield
          className={SubframeUtils.twClassNames(
            "text-caption font-caption text-accent-vivid-indigo",
            {
              "text-orange-700": variant === "resilience",
              "text-lemon-800": variant === "esg",
            }
          )}
        />
      ) : variant === "esg" ? (
        <FeatherLeaf
          className={SubframeUtils.twClassNames(
            "text-caption font-caption text-accent-vivid-indigo",
            {
              "text-orange-700": variant === "resilience",
              "text-lemon-800": variant === "esg",
            }
          )}
        />
      ) : (
        <FeatherBadgeDollarSign
          className={SubframeUtils.twClassNames(
            "text-caption font-caption text-accent-vivid-indigo",
            {
              "text-orange-700": variant === "resilience",
              "text-lemon-800": variant === "esg",
            }
          )}
        />
      )}
      <span
        className={SubframeUtils.twClassNames(
          "text-overline-xs-mono font-overline-xs-mono text-accent-vivid-indigo uppercase",
          {
            "text-orange-700": variant === "resilience",
            "text-lemon-800": variant === "esg",
          }
        )}
      >
        {variant === "resilience"
          ? "resilience"
          : variant === "esg"
          ? "ESG"
          : "Savings"}
      </span>
    </div>
  );
});

export interface ImpactBarsProps extends React.HTMLAttributes<HTMLDivElement> {
  level?: "low" | "medium" | "high";
  className?: string;
}

const ImpactBars = React.forwardRef<HTMLDivElement, ImpactBarsProps>(
  function ImpactBars(
    { level = "high", className, ...otherProps }: ImpactBarsProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/a502fbf9 flex items-start relative h-[18px] w-[18px]",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-1.5 w-1 flex-none items-start rounded-[1px] bg-accent-vivid-indigo absolute top-[11px] left-px" />
        <div
          className={SubframeUtils.twClassNames(
            "flex h-2.5 w-1 flex-none items-start rounded-[1px] bg-accent-vivid-indigo absolute top-[7px] left-[7px]",
            { "bg-alpha-slate-12": level === "low" }
          )}
        />
        <div
          className={SubframeUtils.twClassNames(
            "flex h-3.5 w-1 flex-none items-start rounded-[1px] bg-accent-vivid-indigo absolute top-[3px] left-[13px]",
            { "bg-alpha-slate-12": level === "medium" || level === "low" }
          )}
        />
      </div>
    );
  }
);

export interface ActionItemProps extends React.HTMLAttributes<HTMLDivElement> {
  checkboxSlot?: React.ReactNode;
  label?: React.ReactNode;
  className?: string;
}

const ActionItem = React.forwardRef<HTMLDivElement, ActionItemProps>(
  function ActionItem(
    { checkboxSlot, label, className, ...otherProps }: ActionItemProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-center gap-3 border-b border-solid border-neutral-100 px-2 py-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {checkboxSlot ? (
          <div className="flex items-center">{checkboxSlot}</div>
        ) : null}
        {label ? (
          <span className="grow shrink-0 basis-0 text-caption font-caption text-neutral-700">
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface OpportunityCardRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  categoryLabel?: React.ReactNode;
  categoryIcon?: React.ReactNode;
  daysLeftText?: React.ReactNode;
  title?: React.ReactNode;
  impactText?: React.ReactNode;
  effortText?: React.ReactNode;
  tag1Text?: React.ReactNode;
  tag2Text?: React.ReactNode;
  qualifiedLabel?: React.ReactNode;
  qualifiedPercent?: React.ReactNode;
  qualifiedValue?: number;
  primaryCategory?: React.ReactNode;
  extraCategoryCount?: React.ReactNode;
  signalsText?: React.ReactNode;
  actionsText?: React.ReactNode;
  type?: "savings" | "esg" | "resilience";
  stateInfo?: React.ReactNode;
  emphasis?: "default" | "critical" | "unqualified";
  state?: "collapsed" | "expanded";
  impactSlot?: React.ReactNode;
  unqualifiedActionText?: React.ReactNode;
  commoditySlot?: React.ReactNode;
  narrative?: React.ReactNode;
  primaryActionText?: React.ReactNode;
  askText?: React.ReactNode;
  actionsLabel?: React.ReactNode;
  actionCategory?: React.ReactNode;
  actionOwner?: React.ReactNode;
  actionProgress?: React.ReactNode;
  actionItemsSlot?: React.ReactNode;
  className?: string;
}

const OpportunityCardRoot = React.forwardRef<
  HTMLDivElement,
  OpportunityCardRootProps
>(function OpportunityCardRoot(
  {
    categoryLabel,
    categoryIcon = <FeatherLeafyGreen />,
    daysLeftText,
    title,
    impactText,
    effortText,
    tag1Text,
    tag2Text,
    qualifiedLabel,
    qualifiedPercent,
    qualifiedValue = 85,
    primaryCategory,
    extraCategoryCount,
    signalsText,
    actionsText,
    type = "savings",
    stateInfo,
    emphasis = "default",
    state = "collapsed",
    impactSlot,
    unqualifiedActionText,
    commoditySlot,
    narrative,
    primaryActionText,
    askText,
    actionsLabel,
    actionCategory,
    actionOwner,
    actionProgress,
    actionItemsSlot,
    className,
    ...otherProps
  }: OpportunityCardRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/5a0a6635 flex w-full flex-col items-start rounded-rounded-md bg-default-background shadow-sm",
        {
          "min-h-[320px] border border-dashed border-neutral-400 bg-transparent shadow-none":
            emphasis === "unqualified",
          "border border-solid border-error-600 ring-4 ring-alpha-error-16":
            emphasis === "critical",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full flex-col items-start gap-5 pb-5">
        <div className="flex w-full items-end gap-3 px-6">
          <OppType
            variant={
              type === "resilience"
                ? "resilience"
                : type === "esg"
                ? "esg"
                : undefined
            }
          />
          <div className="flex grow shrink-0 basis-0 items-center gap-3">
            <div className="flex grow shrink-0 basis-0 items-start border-t border-solid border-neutral-200" />
            {stateInfo ? (
              <div className="flex items-center gap-3">{stateInfo}</div>
            ) : null}
          </div>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-start gap-5 px-6",
            { "grow shrink-0 basis-0": emphasis === "unqualified" }
          )}
        >
          <div className="flex w-full flex-col items-start gap-5 pt-1.5 pb-3">
            {title ? (
              <span
                className={SubframeUtils.twClassNames(
                  "w-full text-h6 font-h6 text-neutral-900",
                  {
                    "text-subtitle-1 font-subtitle-1 text-default-font":
                      emphasis === "unqualified",
                  }
                )}
              >
                {title}
              </span>
            ) : null}
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "flex w-full flex-col items-start gap-3 rounded-rounded-sm border border-solid border-alpha-slate-4 bg-neutral-50 px-4 py-5",
              { "bg-default-background": emphasis === "unqualified" }
            )}
          >
            <div className="flex w-full items-center justify-between border-b border-solid border-neutral-200 pb-3 gap-3">
              <div className="flex min-w-[0px] grow shrink-0 basis-0 items-center gap-3">
                {impactSlot ? (
                  <div className="flex items-center">{impactSlot}</div>
                ) : null}
                {impactText ? (
                  <span className="whitespace-nowrap text-h6-max font-h6-max text-neutral-700">
                    {impactText}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-[0px] grow shrink-0 basis-0 items-center gap-3">
                <FeatherTimer className="text-h6-max font-h6-max text-neutral-700 flex-none" />
                {effortText ? (
                  <span className="whitespace-nowrap text-h6-max font-h6-max text-neutral-700">
                    {effortText}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <FeatherArrowDown className="text-caption-xs font-caption-xs text-neutral-700" />
                {tag1Text ? (
                  <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-700 uppercase">
                    {tag1Text}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <FeatherArrowDown className="text-caption-xs font-caption-xs text-error-500" />
                {tag2Text ? (
                  <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-error-500 uppercase">
                    {tag2Text}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div
            className={SubframeUtils.twClassNames(
              "flex w-full items-center gap-3 py-1.5",
              { hidden: emphasis === "unqualified" }
            )}
          >
            {qualifiedLabel ? (
              <span className="whitespace-nowrap text-caption font-caption text-neutral-700">
                {qualifiedLabel}
              </span>
            ) : null}
            <Progress value={qualifiedValue} size="sm" type="brand-fancy" />
            {qualifiedPercent ? (
              <span className="whitespace-nowrap text-caption font-caption text-neutral-700">
                {qualifiedPercent}
              </span>
            ) : null}
          </div>
          <Button
            className={SubframeUtils.twClassNames("hidden", {
              flex: emphasis === "unqualified",
            })}
            variant="gradient"
            size="small"
            slot={<Badge>Badge</Badge>}
          >
            {unqualifiedActionText}
          </Button>
        </div>
      </div>
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-center gap-2.5 border-t border-solid border-neutral-200 px-5 pt-3 pb-4 cursor-pointer transition-colors hover:bg-neutral-50",
          { hidden: emphasis === "unqualified" }
        )}
      >
        {state === "expanded" ? (
          <FeatherChevronDown className="text-body-2 font-body-2 text-neutral-700 flex-none" />
        ) : (
          <FeatherChevronRight className="text-body-2 font-body-2 text-neutral-700 flex-none" />
        )}
        <div className="flex items-center gap-1.5">
          <Badge variant="neutral" size="xs">
            {primaryCategory}
          </Badge>
          <Badge variant="neutral" size="xs">
            {extraCategoryCount}
          </Badge>
        </div>
        <div className="flex grow shrink-0 basis-0 items-start" />
        <div className="flex items-center gap-2">
          {signalsText ? (
            <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-700 uppercase">
              {signalsText}
            </span>
          ) : null}
          <span className="text-overline-xs font-overline-xs text-neutral-300">
            ·
          </span>
          {actionsText ? (
            <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-700 uppercase">
              {actionsText}
            </span>
          ) : null}
        </div>
      </div>
      {commoditySlot ? (
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full flex-wrap items-start gap-2.5 px-6 py-1.5",
            { flex: state === "expanded" }
          )}
        >
          {commoditySlot}
        </div>
      ) : null}
      <div
        className={SubframeUtils.twClassNames(
          "hidden w-full gap-4 border-t border-solid border-neutral-200 px-5 pt-3 pb-4 items-stretch mobile:flex-col",
          { flex: state === "expanded" }
        )}
      >
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-5 px-3 py-4">
          {narrative ? (
            <div className="flex w-full grow shrink-0 basis-0 flex-col items-start">
              {narrative}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-6">
            <Button
              variant="brand"
              size="xsmall"
              iconRight={<FeatherArrowRight />}
              slot={<Badge>Badge</Badge>}
            >
              {primaryActionText}
            </Button>
            <div className="flex h-7 items-center gap-2 border-b border-solid border-accent-vivid-indigo py-2 cursor-pointer">
              {askText ? (
                <span className="whitespace-nowrap text-button-xs font-button-xs text-accent-vivid-indigo">
                  {askText}
                </span>
              ) : null}
              <FeatherSparkles className="text-caption-xs font-caption-xs text-accent-vivid-indigo" />
            </div>
          </div>
        </div>
        <div className="flex w-px flex-none items-start self-stretch bg-neutral-200 mobile:h-px mobile:w-full mobile:flex-none" />
        <div className="flex grow shrink-0 basis-0 flex-col items-start gap-5 px-3 py-4">
          {actionsLabel ? (
            <span className="w-full text-overline font-overline text-neutral-400 uppercase">
              {actionsLabel}
            </span>
          ) : null}
          <div className="flex w-full flex-col items-start gap-3">
            <div className="flex w-full justify-between items-baseline gap-2 uppercase">
              <div className="flex gap-2 items-baseline">
                {actionCategory ? (
                  <span className="whitespace-nowrap text-overline font-overline text-brand-500">
                    {actionCategory}
                  </span>
                ) : null}
                {actionOwner ? (
                  <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-400">
                    {actionOwner}
                  </span>
                ) : null}
              </div>
              {actionProgress ? (
                <span className="whitespace-nowrap text-overline-xs-mono font-overline-xs-mono text-neutral-400">
                  {actionProgress}
                </span>
              ) : null}
            </div>
            {actionItemsSlot ? (
              <div className="flex w-full flex-col items-start gap-1">
                {actionItemsSlot}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});

export const OpportunityCard = Object.assign(OpportunityCardRoot, {
  OppType,
  ImpactBars,
  ActionItem,
});
