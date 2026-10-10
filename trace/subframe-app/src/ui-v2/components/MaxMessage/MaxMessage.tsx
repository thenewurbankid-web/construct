"use client";
/*
 * Documentation:
 * Badge — https://app.subframe.com/de62b029ca8b/library?component=Badge_97bdb082-1124-4dd7-a335-b14b822d0157
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * Max Message — https://app.subframe.com/de62b029ca8b/library?component=Max+Message_40291d54-e866-45cf-b0dc-35d1ec142d0d
 * Max States — https://app.subframe.com/de62b029ca8b/library?component=Max+States_e3215ebb-cac0-4d45-8941-a2c2e1b8beab
 */

import React from "react";
import { FeatherAlertTriangle } from "@subframe/core";
import { FeatherArrowRight } from "@subframe/core";
import { FeatherCheckCircle2 } from "@subframe/core";
import { FeatherChevronDown } from "@subframe/core";
import { FeatherCircleDot } from "@subframe/core";
import { FeatherCopy } from "@subframe/core";
import { FeatherLoader } from "@subframe/core";
import { FeatherPencil } from "@subframe/core";
import { FeatherRefreshCw } from "@subframe/core";
import { FeatherTrash2 } from "@subframe/core";
import { FeatherUploadCloud } from "@subframe/core";
import { FeatherX } from "@subframe/core";
import { FeatherXCircle } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { MaxStates } from "../MaxStates";

export interface StageItemProps extends React.HTMLAttributes<HTMLDivElement> {
  status?:
    | "pending"
    | "active"
    | "complete"
    | "error"
    | "done"
    | "failed"
    | "waiting";
  label?: React.ReactNode;
  className?: string;
}

const StageItem = React.forwardRef<HTMLDivElement, StageItemProps>(
  function StageItem(
    { status = "waiting", label, className, ...otherProps }: StageItemProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/12fc0741 flex items-center gap-2",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {status === "failed" ? (
          <FeatherXCircle
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-neutral-400",
              {
                "text-error-600": status === "failed" || status === "error",
                "text-success-600": status === "done" || status === "complete",
                "text-neutral-500": status === "active",
              }
            )}
          />
        ) : status === "done" ? (
          <FeatherCheckCircle2
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-neutral-400",
              {
                "text-error-600": status === "failed" || status === "error",
                "text-success-600": status === "done" || status === "complete",
                "text-neutral-500": status === "active",
              }
            )}
          />
        ) : status === "error" ? (
          <FeatherXCircle
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-neutral-400",
              {
                "text-error-600": status === "failed" || status === "error",
                "text-success-600": status === "done" || status === "complete",
                "text-neutral-500": status === "active",
              }
            )}
          />
        ) : status === "complete" ? (
          <FeatherCheckCircle2
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-neutral-400",
              {
                "text-error-600": status === "failed" || status === "error",
                "text-success-600": status === "done" || status === "complete",
                "text-neutral-500": status === "active",
              }
            )}
          />
        ) : (
          <FeatherCircleDot
            className={SubframeUtils.twClassNames(
              "text-body-1 font-body-1 text-neutral-400",
              {
                "text-error-600": status === "failed" || status === "error",
                "text-success-600": status === "done" || status === "complete",
                "text-neutral-500": status === "active",
              }
            )}
          />
        )}
        {label ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-caption font-caption text-neutral-400",
              {
                "text-neutral-900":
                  status === "failed" ||
                  status === "error" ||
                  status === "active",
                "text-neutral-800": status === "done" || status === "complete",
              }
            )}
          >
            {label}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface ObjectCardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  metric1Label?: React.ReactNode;
  metric1Value?: React.ReactNode;
  metric2Label?: React.ReactNode;
  metric2Value?: React.ReactNode;
  footerLabel?: React.ReactNode;
  metric3Label?: React.ReactNode;
  metric3Value?: React.ReactNode;
  className?: string;
}

const ObjectCard = React.forwardRef<HTMLDivElement, ObjectCardProps>(
  function ObjectCard(
    {
      title,
      subtitle,
      metric1Label,
      metric1Value,
      metric2Label,
      metric2Value,
      footerLabel,
      metric3Label,
      metric3Value,
      className,
      ...otherProps
    }: ObjectCardProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div className="flex w-full flex-col items-start gap-1 px-4 py-3">
          {title ? (
            <span className="text-subtitle-1 font-subtitle-1 text-neutral-900">
              {title}
            </span>
          ) : null}
          {subtitle ? (
            <span className="text-caption font-caption text-neutral-500">
              {subtitle}
            </span>
          ) : null}
        </div>
        <div className="flex w-full items-center gap-6 border-t border-solid border-neutral-200 bg-neutral-50 px-6 py-6">
          <div className="flex min-w-[128px] flex-col items-start gap-1.5">
            {metric1Label ? (
              <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                {metric1Label}
              </span>
            ) : null}
            {metric1Value ? (
              <span className="text-h6-max font-h6-max text-neutral-900">
                {metric1Value}
              </span>
            ) : null}
          </div>
          <div className="flex w-32 flex-none flex-col items-start gap-1.5">
            {metric2Label ? (
              <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                {metric2Label}
              </span>
            ) : null}
            {metric2Value ? (
              <span className="text-h6-max font-h6-max text-neutral-900">
                {metric2Value}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-1.5">
            {metric3Label ? (
              <span className="text-overline-xs-mono font-overline-xs-mono text-neutral-500 uppercase">
                {metric3Label}
              </span>
            ) : null}
            {metric3Value ? (
              <span className="text-h6-max font-h6-max text-neutral-900">
                {metric3Value}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex w-full items-center gap-2 border-t border-solid border-neutral-200 pt-2 pb-1">
          <Button
            variant="brand-subtle"
            size="xsmall"
            iconRight={<FeatherArrowRight />}
            slot={<Badge>Badge</Badge>}
          >
            {footerLabel}
          </Button>
        </div>
      </div>
    );
  }
);

export interface FileChipProps extends React.HTMLAttributes<HTMLDivElement> {
  fileName?: React.ReactNode;
  status?: "uploading" | "reading" | "read" | "insufficient" | "unreadable";
  meta?: React.ReactNode;
  className?: string;
}

const FileChip = React.forwardRef<HTMLDivElement, FileChipProps>(
  function FileChip(
    {
      fileName,
      status = "read",
      meta,
      className,
      ...otherProps
    }: FileChipProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/ba87765c flex items-center gap-2 rounded-rounded-xs border border-solid border-cyan-200 bg-default-background px-2 py-1.5",
          {
            "border border-solid border-warning-300":
              status === "unreadable" || status === "insufficient",
            "border border-solid border-neutral-200":
              status === "reading" || status === "uploading",
          },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex h-6 w-6 flex-none items-center justify-center rounded-rounded-xs bg-cyan-50",
            {
              "bg-warning-50":
                status === "unreadable" || status === "insufficient",
              "bg-neutral-100": status === "reading" || status === "uploading",
            }
          )}
        >
          {status === "unreadable" ? (
            <FeatherXCircle
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-cyan-600",
                {
                  "text-warning-600":
                    status === "unreadable" || status === "insufficient",
                  "text-neutral-500":
                    status === "reading" || status === "uploading",
                }
              )}
            />
          ) : status === "insufficient" ? (
            <FeatherAlertTriangle
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-cyan-600",
                {
                  "text-warning-600":
                    status === "unreadable" || status === "insufficient",
                  "text-neutral-500":
                    status === "reading" || status === "uploading",
                }
              )}
            />
          ) : status === "reading" ? (
            <FeatherLoader
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-cyan-600",
                {
                  "text-warning-600":
                    status === "unreadable" || status === "insufficient",
                  "text-neutral-500":
                    status === "reading" || status === "uploading",
                }
              )}
            />
          ) : status === "uploading" ? (
            <FeatherUploadCloud
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-cyan-600",
                {
                  "text-warning-600":
                    status === "unreadable" || status === "insufficient",
                  "text-neutral-500":
                    status === "reading" || status === "uploading",
                }
              )}
            />
          ) : (
            <FeatherCheckCircle2
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-cyan-600",
                {
                  "text-warning-600":
                    status === "unreadable" || status === "insufficient",
                  "text-neutral-500":
                    status === "reading" || status === "uploading",
                }
              )}
            />
          )}
        </div>
        <div className="flex grow shrink-0 basis-0 flex-col items-start">
          {fileName ? (
            <span className="text-caption font-caption text-default-font">
              {fileName}
            </span>
          ) : null}
          {meta ? (
            <span className="text-caption-xs font-caption-xs text-neutral-400">
              {meta}
            </span>
          ) : null}
        </div>
        <FeatherX className="text-caption font-caption text-neutral-400 cursor-pointer hover:text-neutral-600" />
      </div>
    );
  }
);

export interface ThinkingTraceProps
  extends React.HTMLAttributes<HTMLDivElement> {
  text?: React.ReactNode;
  className?: string;
}

const ThinkingTrace = React.forwardRef<HTMLDivElement, ThinkingTraceProps>(
  function ThinkingTrace(
    { text, className, ...otherProps }: ThinkingTraceProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex w-full flex-col items-start gap-2 overflow-hidden border-l border-solid border-neutral-300 pl-4 py-1",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {text ? (
          <span className="whitespace-pre-wrap text-body-2-max font-body-2-max text-neutral-600">
            {text}
          </span>
        ) : null}
      </div>
    );
  }
);

export interface MessageActionProps
  extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  className?: string;
}

const MessageAction = React.forwardRef<HTMLDivElement, MessageActionProps>(
  function MessageAction(
    {
      icon = <FeatherRefreshCw />,
      className,
      ...otherProps
    }: MessageActionProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "flex h-4 w-4 cursor-pointer items-center justify-center rounded-[6px]",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        {icon ? (
          <SubframeCore.IconWrapper className="text-caption font-caption text-neutral-400 hover:text-neutral-600">
            {icon}
          </SubframeCore.IconWrapper>
        ) : null}
      </div>
    );
  }
);

export interface StatusProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  hideChevron?: boolean;
  tone?: "default" | "error";
  className?: string;
}

const Status = React.forwardRef<HTMLDivElement, StatusProps>(function Status(
  {
    label,
    hideChevron = false,
    tone = "default",
    className,
    ...otherProps
  }: StatusProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/55116891 flex items-center gap-5 py-0.5",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex items-center gap-2">
        {label ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-caption font-caption text-neutral-500",
              { "text-error-600": tone === "error" }
            )}
          >
            {label}
          </span>
        ) : null}
        <FeatherChevronDown
          className={SubframeUtils.twClassNames(
            "text-caption font-caption text-neutral-500",
            { hidden: hideChevron }
          )}
        />
      </div>
    </div>
  );
});

export interface NoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode;
  text?: React.ReactNode;
  hideHeading?: boolean;
  hideActions?: boolean;
  tone?: "info" | "caution" | "provisional" | "error";
  actionsSlot?: React.ReactNode;
  className?: string;
}

const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  {
    heading,
    text,
    hideHeading = false,
    hideActions = false,
    tone = "info",
    actionsSlot,
    className,
    ...otherProps
  }: NoticeProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "group/169fbe6d flex w-full flex-col items-start justify-center gap-3 rounded-rounded-sm border border-solid border-alpha-brand-16 px-3.5 py-3",
        {
          "border border-solid border-alpha-error-16": tone === "error",
          "border border-solid border-alpha-brand-32": tone === "provisional",
          "border border-solid border-alpha-warning-16": tone === "caution",
        },
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex w-full flex-col items-start gap-1">
        {heading ? (
          <span
            className={SubframeUtils.twClassNames(
              "text-subtitle-2 font-subtitle-2 text-neutral-800",
              { hidden: hideHeading }
            )}
          >
            {heading}
          </span>
        ) : null}
        {text ? (
          <span className="whitespace-pre-wrap text-body-2 font-body-2 text-neutral-800">
            {text}
          </span>
        ) : null}
      </div>
      {actionsSlot ? (
        <div
          className={SubframeUtils.twClassNames("flex items-center gap-2", {
            hidden: hideActions,
          })}
        >
          {actionsSlot}
        </div>
      ) : null}
    </div>
  );
});

export interface SourcesProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: React.ReactNode;
  className?: string;
}

const Sources = React.forwardRef<HTMLDivElement, SourcesProps>(function Sources(
  { count, className, ...otherProps }: SourcesProps,
  ref
) {
  return (
    <div
      className={SubframeUtils.twClassNames(
        "flex items-center gap-1.5 rounded-[6px] px-1.5 py-1.5 group/sourcescomp",
        className
      )}
      ref={ref}
      {...otherProps}
    >
      <div className="flex items-center">
        <div className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 border-solid border-white bg-white shadow-xs -mr-1" />
        <div className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 border-solid border-white bg-white shadow-xs -mr-1" />
        <div className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 border-solid border-white bg-white shadow-xs -mr-1" />
        <div className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 border-solid border-white bg-white shadow-xs" />
      </div>
      {count ? (
        <span className="text-caption-mono font-caption-mono text-neutral-600">
          {count}
        </span>
      ) : null}
    </div>
  );
});

export interface MaxMessageRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "processing" | "streaming" | "complete" | "error";
  header?: React.ReactNode;
  processingItems?: React.ReactNode;
  errorItems?: React.ReactNode;
  response?: React.ReactNode;
  metaUtility?: React.ReactNode;
  fallbackMessage?: React.ReactNode;
  sourceText?: React.ReactNode;
  embeddedContent?: React.ReactNode;
  inlineActions?: React.ReactNode;
  thinkingStages?: React.ReactNode;
  notice?: React.ReactNode;
  nudge?: React.ReactNode;
  hideAuthor?: boolean;
  actions?: React.ReactNode;
  responseHeading?: React.ReactNode;
  responseText?: React.ReactNode;
  hideStatus?: boolean;
  hideThinkingTraces?: boolean;
  hideStages?: boolean;
  hideResponse?: boolean;
  hideWidgets?: boolean;
  hideActions?: boolean;
  hideNotice?: boolean;
  hideNudge?: boolean;
  hideMessageActions?: boolean;
  focusedModeLabel?: React.ReactNode;
  hideFocusedMode?: boolean;
  className?: string;
}

const MaxMessageRoot = React.forwardRef<HTMLDivElement, MaxMessageRootProps>(
  function MaxMessageRoot(
    {
      variant = "processing",
      header,
      processingItems,
      errorItems,
      response,
      metaUtility,
      fallbackMessage,
      sourceText,
      embeddedContent,
      inlineActions,
      thinkingStages,
      notice,
      nudge,
      hideAuthor = false,
      actions,
      responseHeading,
      responseText,
      hideStatus = false,
      hideThinkingTraces = false,
      hideStages = false,
      hideResponse = false,
      hideWidgets = false,
      hideActions = false,
      hideNotice = false,
      hideNudge = false,
      hideMessageActions = false,
      focusedModeLabel,
      hideFocusedMode = false,
      className,
      ...otherProps
    }: MaxMessageRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/40291d54 flex w-full items-start gap-3 pl-1 pr-7",
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex h-5 w-5 flex-none items-center justify-center",
            { hidden: hideAuthor }
          )}
        >
          <MaxStates className="h-5 w-5 flex-none" variant="default" />
        </div>
        <div className="flex min-w-[0px] grow shrink-0 basis-0 flex-col items-start gap-2">
          {header ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex w-full min-w-[0px] items-start gap-2",
                { hidden: hideStatus }
              )}
            >
              {header}
            </div>
          ) : null}
          {thinkingStages ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex w-full min-w-[0px] flex-col items-start gap-1",
                {
                  hidden:
                    hideThinkingTraces ||
                    variant === "error" ||
                    variant === "complete",
                }
              )}
            >
              {thinkingStages}
            </div>
          ) : null}
          {processingItems ? (
            <div
              className={SubframeUtils.twClassNames(
                "flex w-full min-w-[0px] flex-col items-start gap-3",
                {
                  hidden:
                    hideStages ||
                    variant === "error" ||
                    variant === "complete" ||
                    variant === "streaming",
                }
              )}
            >
              {processingItems}
            </div>
          ) : null}
          {actions ? (
            <div
              className={SubframeUtils.twClassNames("flex items-start py-1", {
                hidden:
                  hideActions || variant === "error" || variant === "complete",
              })}
            >
              {actions}
            </div>
          ) : null}
          {errorItems ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full min-w-[0px] flex-col items-start gap-3",
                { flex: variant === "error" }
              )}
            >
              {errorItems}
            </div>
          ) : null}
          {fallbackMessage ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden text-caption-max font-caption-max text-neutral-400",
                { inline: variant === "error" }
              )}
            >
              {fallbackMessage}
            </span>
          ) : null}
          {response ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full min-w-[0px] flex-col items-start gap-2 pt-1 pb-3",
                { flex: variant === "complete" || variant === "streaming" }
              )}
            >
              {response}
            </div>
          ) : null}
          {responseHeading ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden w-full text-h6 font-h6 text-neutral-800",
                { inline: variant === "complete" || variant === "streaming" }
              )}
            >
              {responseHeading}
            </span>
          ) : null}
          {responseText ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden w-full text-body-2 font-body-2 text-neutral-800",
                { inline: variant === "complete" || variant === "streaming" }
              )}
            >
              {responseText}
            </span>
          ) : null}
          {embeddedContent ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full min-w-[0px] flex-col items-start",
                { flex: variant === "complete" || variant === "streaming" }
              )}
            >
              {embeddedContent}
            </div>
          ) : null}
          {inlineActions ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full min-w-[0px] flex-wrap items-center gap-2",
                { flex: variant === "complete" || variant === "streaming" }
              )}
            >
              {inlineActions}
            </div>
          ) : null}
          {sourceText ? (
            <span
              className={SubframeUtils.twClassNames(
                "hidden text-caption font-caption text-neutral-400",
                { inline: variant === "complete" }
              )}
            >
              {sourceText}
            </span>
          ) : null}
          {notice ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full min-w-[0px] flex-col items-start",
                { flex: variant === "error" || variant === "complete" }
              )}
            >
              {notice}
            </div>
          ) : null}
          {nudge ? (
            <div
              className={SubframeUtils.twClassNames(
                "hidden w-full items-center justify-center py-1",
                { flex: variant === "complete" }
              )}
            >
              {nudge}
            </div>
          ) : null}
          <div
            className={SubframeUtils.twClassNames(
              "hidden min-h-[28px] w-full items-center gap-2",
              { flex: variant === "complete" }
            )}
          >
            <div
              className={SubframeUtils.twClassNames(
                "flex grow shrink-0 basis-0 items-center gap-2",
                { hidden: hideMessageActions }
              )}
            >
              <MessageAction icon={<FeatherRefreshCw />} />
              <MessageAction icon={<FeatherTrash2 />} />
              <MessageAction icon={<FeatherCopy />} />
              <MessageAction icon={<FeatherPencil />} />
            </div>
            {metaUtility ? (
              <div className="flex items-center">{metaUtility}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
);

export const MaxMessage = Object.assign(MaxMessageRoot, {
  StageItem,
  ObjectCard,
  FileChip,
  ThinkingTrace,
  MessageAction,
  Status,
  Notice,
  Sources,
});
