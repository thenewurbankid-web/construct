"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Opportunity Row — https://app.subframe.com/de62b029ca8b/library?component=Opportunity+Row_c858c57b-bd57-419f-b3f5-5c96dbda2ddc
 */

import React from "react";
import { FeatherArrowRight } from "@subframe/core";
import { FeatherCheck } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherLeaf } from "@subframe/core";
import { FeatherMoreVertical } from "@subframe/core";
import { FeatherShield } from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";

export interface SuggestionChipProps
  extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  className?: string;
}

const SuggestionChip = React.forwardRef<HTMLDivElement, SuggestionChipProps>(
  function SuggestionChip(
    { label, className, ...otherProps }: SuggestionChipProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/ed5cb67d flex cursor-pointer items-center rounded-t-rounded-xs rounded-bl-rounded-xs border border-solid border-alpha-brand-16 bg-alpha-brand-4 px-3 py-1.5 hover:bg-alpha-brand-8",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {label ? (
          <span className="text-caption font-caption text-accent-vivid-indigo">
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface TradeOffProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  kind?: "risk" | "esg";
  className?: string;
}

const TradeOff = React.forwardRef<HTMLDivElement, TradeOffProps>(
  function TradeOff(
    { label, kind = "risk", className, ...otherProps }: TradeOffProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/7e42465e flex w-full items-center gap-2 py-1",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {kind === "esg" ? (
          <FeatherLeaf className="text-body-2 font-body-2 text-neutral-700 flex-none" />
        ) : (
          <FeatherShield className="text-body-2 font-body-2 text-neutral-700 flex-none" />
        )}
        {label ? (
          <span className="text-body-2 font-body-2 text-neutral-700">
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface TaskItemProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  done?: boolean;
  className?: string;
}

const TaskItem = React.forwardRef<HTMLDivElement, TaskItemProps>(
  function TaskItem(
    { label, done = false, className, ...otherProps }: TaskItemProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/cedc0f9e flex w-full cursor-pointer items-center gap-3 border-b border-solid border-alpha-slate-8 px-2 py-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px] bg-neutral-100">
          <div
            className={SubframeUtils.twClassNames(
              "flex h-4 w-4 flex-none items-center justify-center rounded-full border border-solid border-alpha-slate-16",
              {
                "bg-accent-vivid-indigo border-solid border-alpha-slate-16 border-0":
                  done,
              }
            )}
          >
            <FeatherCheck
              className={SubframeUtils.twClassNames(
                "hidden text-caption-xs font-caption-xs text-white",
                { inline: done }
              )}
            />
          </div>
        </div>
        {label ? (
          <span
            className={SubframeUtils.twClassNames(
              "min-w-[0px] grow shrink-0 basis-0 text-caption font-caption text-neutral-700",
              { "line-through": done }
            )}
          >
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface CategoryRowProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: React.ReactNode;
  band?: React.ReactNode;
  confidence?: React.ReactNode;
  qualified?: boolean;
  actionLabel?: React.ReactNode;
  collapsed?: boolean;
  className?: string;
}

const CategoryRow = React.forwardRef<HTMLDivElement, CategoryRowProps>(
  function CategoryRow(
    {
      name,
      band,
      confidence,
      qualified = false,
      actionLabel,
      collapsed = false,
      className,
      ...otherProps
    }: CategoryRowProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/cfba41a4 flex w-full items-center gap-6 border-b border-solid border-alpha-slate-8 px-2 py-2.5",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {name ? (
          <span className="min-w-[0px] grow shrink-0 basis-0 text-body-2 font-body-2 text-neutral-800">
            {name}
          </span>
        ) : null}
        {band ? (
          <span
            className={SubframeUtils.twClassNames(
              "grow shrink-0 basis-0 whitespace-nowrap text-caption font-caption text-accent-vivid-indigo",
              { "text-neutral-500": qualified }
            )}
          >
            {band}
          </span>
        ) : null}
        <div
          className={SubframeUtils.twClassNames(
            "flex w-24 flex-none flex-col items-end gap-0.5",
            { "w-auto flex-row items-center gap-1": collapsed }
          )}
        >
          {confidence ? (
            <span
              className={SubframeUtils.twClassNames(
                "whitespace-nowrap text-caption font-caption text-neutral-700 text-right",
                { "text-neutral-400": qualified }
              )}
            >
              {confidence}
            </span>
          ) : null}
          <span
            className={SubframeUtils.twClassNames(
              "text-overline-xs font-overline-xs text-neutral-400 uppercase",
              { hidden: qualified }
            )}
          >
            CONFIDENCE
          </span>
          <span
            className={SubframeUtils.twClassNames(
              "hidden text-overline-xs font-overline-xs text-neutral-400 uppercase",
              { inline: qualified }
            )}
          >
            NOT QUALIFIED
          </span>
        </div>
        <Button
          className={SubframeUtils.twClassNames("hidden", { flex: qualified })}
          variant="outline"
          size="small"
          slot={<Badge>Badge</Badge>}
        >
          Qualify
        </Button>
        <Button
          className={SubframeUtils.twClassNames({
            hidden: collapsed || qualified,
          })}
          variant="brand-subtle"
          size="xsmall"
          slot={<Badge>Badge</Badge>}
        >
          {actionLabel}
        </Button>
      </div>
    );
  }
);

export interface SignalRowProps extends React.HTMLAttributes<HTMLDivElement> {
  headline?: React.ReactNode;
  detail?: React.ReactNode;
  actionLabel?: React.ReactNode;
  className?: string;
}

const SignalRow = React.forwardRef<HTMLDivElement, SignalRowProps>(
  function SignalRow(
    { headline, detail, actionLabel, className, ...otherProps }: SignalRowProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full items-start gap-4 border-b border-solid border-warning-200 py-3",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-1">
          {headline ? (
            <span className="text-subtitle-2 font-subtitle-2 text-neutral-900">
              {headline}
            </span>
          ) : null}
          {detail ? (
            <span className="text-caption font-caption text-neutral-600">
              {detail}
            </span>
          ) : null}
        </div>
        {actionLabel ? (
          <span className="whitespace-nowrap text-subtitle-2 font-subtitle-2 text-neutral-900 cursor-pointer">
            {actionLabel}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface OpportunityRowRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  type?:
    | "default"
    | "in-progress"
    | "impacted"
    | "potential"
    | "multi-category"
    | "completed";
  state?: "default" | "hover" | "expanded";
  indexLabel?: React.ReactNode;
  title?: React.ReactNode;
  narrative?: React.ReactNode;
  askLabel?: React.ReactNode;
  lens?: "savings" | "esg" | "resilience";
  impactLabel?: React.ReactNode;
  categoryLabel?: React.ReactNode;
  horizonLabel?: React.ReactNode;
  stateLabel?: React.ReactNode;
  qualifiedPercent?: React.ReactNode;
  confidenceLabel?: React.ReactNode;
  benefitValue?: React.ReactNode;
  benefitLabel?: React.ReactNode;
  effortValue?: React.ReactNode;
  effortLabel?: React.ReactNode;
  actionsCount?: React.ReactNode;
  actionsFooter?: React.ReactNode;
  primaryActionLabel?: React.ReactNode;
  metaSlot?: React.ReactNode;
  signalsSlot?: React.ReactNode;
  tradeOffsSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  categoryRowsSlot?: React.ReactNode;
  askSlot?: React.ReactNode;
  suggestionsSlot?: React.ReactNode;
  className?: string;
}

const OpportunityRowRoot = React.forwardRef<
  HTMLDivElement,
  OpportunityRowRootProps
>(function OpportunityRowRoot(
  {
    type = "default",
    state = "default",
    indexLabel,
    title,
    narrative,
    askLabel,
    lens = "savings",
    impactLabel,
    categoryLabel,
    horizonLabel,
    stateLabel,
    qualifiedPercent,
    confidenceLabel,
    benefitValue,
    benefitLabel,
    effortValue,
    effortLabel,
    actionsCount,
    actionsFooter,
    primaryActionLabel,
    metaSlot,
    signalsSlot,
    tradeOffsSlot,
    actionsSlot,
    categoryRowsSlot,
    askSlot,
    suggestionsSlot,
    className,
    ...otherProps
  }: OpportunityRowRootProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/c858c57b flex w-full flex-col items-start border-b border-solid border-alpha-shadow-12 px-8 py-4 group/opprow mobile:px-4",
        {
          "rounded-rounded-md border border-solid border-alpha-brand-16 bg-alpha-white-80":
            state === "expanded",
          "rounded-rounded-md border border-solid border-alpha-shadow-12 bg-alpha-slate-4":
            state === "hover",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full flex-col items-start gap-6 py-6">
        <div className="flex w-full items-start gap-6 mobile:gap-3">
          <div className="flex flex-col items-start">
            <div
              className={SubframeUtils.twClassNames(
                "flex h-0.5 w-10 flex-none items-start bg-accent-vivid-indigo",
                {
                  "bg-neutral-300": type === "potential",
                  "bg-error-500": type === "impacted",
                }
              )}
            />
            <div className="flex h-[18px] w-full flex-none items-start" />
            {indexLabel ? (
              <span
                className={SubframeUtils.twClassNames(
                  "w-[37px] text-h5 font-h5 text-accent-vivid-indigo",
                  {
                    "text-neutral-400": type === "potential",
                    "text-error-500": type === "impacted",
                  }
                )}
              >
                {indexLabel}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-7">
            <div className="flex w-full items-start gap-2">
              <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-3">
                {metaSlot ? (
                  <div className="flex w-full flex-wrap items-center gap-2">
                    {metaSlot}
                  </div>
                ) : null}
                {title ? (
                  <span className="w-full text-h6 font-h6 text-neutral-900">
                    {title}
                  </span>
                ) : null}
                <div className="flex w-full flex-wrap gap-1 items-baseline">
                  {narrative ? (
                    <span className="text-body-2 font-body-2 text-neutral-900">
                      {narrative}
                    </span>
                  ) : null}
                  {askLabel ? (
                    <span className="text-body-2 font-body-2 text-accent-soft-indigo underline cursor-pointer">
                      {askLabel}
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                className={SubframeUtils.twClassNames(
                  "hidden items-center justify-center",
                  { flex: state === "expanded" }
                )}
              >
                <div
                  className={SubframeUtils.twClassNames(
                    "hidden h-10 w-10 flex-none items-center justify-center rounded-full",
                    { flex: state === "expanded" }
                  )}
                >
                  {qualifiedPercent ? (
                    <span className="h-[34px] w-[34px] flex-none text-caption-xs font-caption-xs text-neutral-600 flex items-center justify-center rounded-full bg-default-background">
                      {qualifiedPercent}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full flex-col items-start gap-3 rounded-rounded-sm border border-solid border-warning-200 bg-warning-50 px-6 py-6",
                { flex: state === "expanded" }
              )}
            >
              <span className="text-overline-xs font-overline-xs text-warning-700 uppercase">
                Signals impacting this opportunity
              </span>
              {signalsSlot ? (
                <div className="flex w-full flex-col items-start">
                  {signalsSlot}
                </div>
              ) : null}
            </div>
            {categoryRowsSlot ? (
              <div
                className={SubframeUtils.twClassNames(
                  "hidden w-full flex-col items-start",
                  { flex: state === "expanded" || type === "multi-category" }
                )}
              >
                {categoryRowsSlot}
              </div>
            ) : null}
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full items-start gap-10 rounded-rounded-sm mobile:flex-col mobile:gap-6",
                { flex: state === "expanded" }
              )}
            >
              <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-2">
                <div className="flex h-px w-full flex-none items-start bg-neutral-200" />
                <div className="flex w-full flex-col items-start gap-2 py-2">
                  <span className="w-full text-overline-xs font-overline-xs text-neutral-600 uppercase">
                    If you act
                  </span>
                  <div className="flex w-full flex-wrap items-end gap-10 py-2">
                    <div className="flex flex-col items-start justify-center gap-1">
                      {benefitValue ? (
                        <span className="whitespace-nowrap text-h5-max font-h5-max text-neutral-700">
                          {benefitValue}
                        </span>
                      ) : null}
                      {benefitLabel ? (
                        <span className="whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase">
                          {benefitLabel}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-start justify-center gap-1">
                      {effortValue ? (
                        <span className="whitespace-nowrap text-h5-max font-h5-max text-neutral-800">
                          {effortValue}
                        </span>
                      ) : null}
                      {effortLabel ? (
                        <span className="whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase">
                          {effortLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex h-px w-full flex-none items-start bg-neutral-200" />
                <div className="flex w-full flex-col items-start gap-2 py-2">
                  <span className="w-full text-overline-xs font-overline-xs text-neutral-600 uppercase">
                    Also
                  </span>
                  {tradeOffsSlot ? (
                    <div className="flex w-full flex-col items-start">
                      {tradeOffsSlot}
                    </div>
                  ) : null}
                </div>
                <div className="flex w-full items-start gap-2.5 py-3">
                  <div className="flex h-10 min-w-[100px] items-center justify-center gap-2 rounded-rounded-sm border-2 border-solid border-alpha-brand-8 bg-alpha-brand-16 px-3.5 cursor-pointer transition-colors hover:bg-alpha-brand-24">
                    {primaryActionLabel ? (
                      <span className="text-button font-button text-brand-600">
                        {primaryActionLabel}
                      </span>
                    ) : null}
                    <FeatherArrowRight className="text-body-2 font-body-2 text-brand-600" />
                  </div>
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-rounded-sm border border-solid border-neutral-200 bg-default-background cursor-pointer transition-colors hover:bg-neutral-50">
                    <FeatherMoreVertical className="text-body-2 font-body-2 text-neutral-700" />
                  </div>
                </div>
              </div>
              <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-7 px-4 tablet:max-w-[320px]">
                <div className="flex w-full flex-col items-start gap-3">
                  <div className="flex w-full justify-between items-baseline gap-2 uppercase">
                    <span className="text-overline-xs font-overline-xs text-neutral-600">
                      Actions
                    </span>
                    {actionsCount ? (
                      <span className="whitespace-nowrap text-overline-xs font-overline-xs text-neutral-400">
                        {actionsCount}
                      </span>
                    ) : null}
                  </div>
                  {actionsSlot ? (
                    <div className="flex w-full flex-col items-start gap-1">
                      {actionsSlot}
                    </div>
                  ) : null}
                  {actionsFooter ? (
                    <span className="text-caption font-caption text-neutral-500 px-2">
                      {actionsFooter}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 mobile:flex-col mobile:flex-nowrap mobile:items-start mobile:gap-3">
              <div className="flex min-w-[0px] items-center gap-3 grow basis-0 shrink">
                {confidenceLabel ? (
                  <span className="whitespace-nowrap text-overline-xs font-overline-xs text-neutral-500 uppercase">
                    {confidenceLabel}
                  </span>
                ) : null}
                <div
                  className={SubframeUtils.twClassNames(
                    "flex h-1 w-[154px] flex-none items-start overflow-hidden rounded-full bg-alpha-slate-4 min-w-[0px] max-w-full shrink",
                    { hidden: type === "potential" }
                  )}
                >
                  <div
                    className={SubframeUtils.twClassNames(
                      "flex items-start self-stretch rounded-full bg-accent-soft-indigo w-[70%]",
                      { "bg-error-500": type === "impacted" }
                    )}
                  />
                </div>
                <div
                  className={SubframeUtils.twClassNames(
                    "hidden h-1 w-1 flex-none items-start rounded-full bg-neutral-400",
                    { flex: type === "potential" }
                  )}
                />
              </div>
              <div className="flex items-center gap-1.5 cursor-pointer">
                <span className="text-caption font-caption text-accent-vivid-indigo">
                  {state === "expanded" ? "Collapse" : "Expand"}
                </span>
                <FeatherChevronDown
                  className={SubframeUtils.twClassNames(
                    "text-h5 font-h5 text-accent-vivid-indigo transition-transform",
                    { "rotate-180": state === "expanded" }
                  )}
                />
              </div>
            </div>
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full flex-col items-start gap-3",
                { flex: state === "expanded" }
              )}
            >
              <div className="flex h-px w-full flex-none items-start bg-neutral-200" />
              <div className="flex w-full flex-wrap items-center gap-3">
                <span className="text-overline-xs font-overline-xs text-neutral-500 uppercase">
                  Ask about this
                </span>
                {suggestionsSlot ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {suggestionsSlot}
                  </div>
                ) : null}
              </div>
              {askSlot ? (
                <div className="flex w-full flex-col items-start">
                  {askSlot}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const OpportunityRow = Object.assign(OpportunityRowRoot, {
  SuggestionChip,
  TradeOff,
  TaskItem,
  CategoryRow,
  SignalRow,
});
