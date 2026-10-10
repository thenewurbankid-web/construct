"use client";
/*
 * Documentation:
 * Alert — https://app.subframe.com/de62b029ca8b/library?component=Alert_3a65613d-d546-467c-80f4-aaba6a7edcd5
 * Button — https://app.subframe.com/de62b029ca8b/library?component=Button_3b777358-b86b-40af-9327-891efc6826fe
 * FileUpload — https://app.subframe.com/de62b029ca8b/library?component=FileUpload_7513b66f-776e-478f-b374-6d7ace975cc5
 * Icon Button — https://app.subframe.com/de62b029ca8b/library?component=Icon+Button_af9405b1-8c54-4e01-9786-5aad308224f6
 * Loader — https://app.subframe.com/de62b029ca8b/library?component=Loader_f2e570c8-e463-45c2-aae9-a960146bc5d5
 */

import React from "react";
import { FeatherAlertCircle } from "@subframe/core";
import { FeatherCheckCircle2 } from "@subframe/core";
import { FeatherFile } from "@subframe/core";
import { FeatherRotateCcw } from "@subframe/core";
import { FeatherUpload } from "@subframe/core";
import { FeatherX } from "@subframe/core";
import * as SubframeCore from "@subframe/core";
import * as SubframeUtils from "../../utils";
import { Alert } from "../Alert";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { Loader } from "../Loader";

export interface FileUploadRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  state?:
    | "empty"
    | "dragging"
    | "selected"
    | "processing"
    | "success"
    | "error";
  title?: React.ReactNode;
  description?: React.ReactNode;
  fileName?: React.ReactNode;
  fileMeta?: React.ReactNode;
  statusMessage?: React.ReactNode;
  primaryLabel?: React.ReactNode;
  secondaryLabel?: React.ReactNode;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

const FileUploadRoot = React.forwardRef<HTMLDivElement, FileUploadRootProps>(
  function FileUploadRoot(
    {
      state = "empty",
      title,
      description,
      fileName,
      fileMeta,
      statusMessage,
      primaryLabel,
      secondaryLabel,
      disabled = false,
      icon = <FeatherUpload />,
      className,
      ...otherProps
    }: FileUploadRootProps,
    ref
  ) {
    return (
      <div
        className={SubframeUtils.twClassNames(
          "group/7513b66f flex w-full flex-col items-start gap-3",
          { "opacity-50 pointer-events-none": disabled },
          className
        )}
        ref={ref}
        {...otherProps}
      >
        <div
          className={SubframeUtils.twClassNames(
            "flex w-full flex-col items-center justify-center gap-4 rounded-rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-6 py-10 focus-within:border-brand-400 focus-within:bg-alpha-brand-4 mobile:px-4 mobile:py-8",
            {
              hidden:
                state === "error" ||
                state === "success" ||
                state === "processing" ||
                state === "selected",
              "border border-dashed border-brand-400 bg-alpha-brand-4":
                state === "dragging",
            }
          )}
        >
          <div
            className={SubframeUtils.twClassNames(
              "flex h-12 w-12 flex-none items-center justify-center rounded-full bg-neutral-100",
              { "bg-alpha-brand-8": state === "dragging" }
            )}
          >
            {icon ? (
              <SubframeCore.IconWrapper
                className={SubframeUtils.twClassNames(
                  "text-body-1 font-body-1 text-neutral-400",
                  { "text-brand-500": state === "dragging" }
                )}
              >
                {icon}
              </SubframeCore.IconWrapper>
            ) : null}
          </div>
          {title ? (
            <span
              className={SubframeUtils.twClassNames(
                "text-body-2-bold font-body-2-bold text-default-font text-center",
                { "text-brand-600": state === "dragging" }
              )}
            >
              {title}
            </span>
          ) : null}
          {description ? (
            <span
              className={SubframeUtils.twClassNames(
                "text-caption font-caption text-subtext-color text-center",
                { "text-brand-500": state === "dragging" }
              )}
            >
              {description}
            </span>
          ) : null}
          <Button
            variant="primary"
            size="small"
            icon={<FeatherUpload />}
            badge={false}
          >
            {primaryLabel}
          </Button>
        </div>
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full items-center gap-3 rounded-rounded-sm border border-solid border-neutral-200 bg-neutral-50 px-3 py-3",
            { flex: state === "processing" || state === "selected" }
          )}
        >
          <div className="flex grow shrink-0 basis-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-rounded-xs bg-neutral-200">
              <FeatherFile className="text-body-2 font-body-2 text-neutral-500" />
            </div>
            <div className="flex grow shrink-0 basis-0 flex-col items-start gap-0.5">
              {fileName ? (
                <span className="text-body-2-bold font-body-2-bold text-default-font">
                  {fileName}
                </span>
              ) : null}
              {fileMeta ? (
                <span className="text-caption font-caption text-subtext-color">
                  {fileMeta}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 mobile:grow mobile:shrink-0 mobile:basis-0 mobile:justify-end">
            <Loader
              className={SubframeUtils.twClassNames("hidden", {
                "inline-block": state === "processing",
              })}
              size="small"
            />
            {statusMessage ? (
              <span
                className={SubframeUtils.twClassNames(
                  "hidden text-caption font-caption text-subtext-color",
                  { inline: state === "processing" }
                )}
              >
                {statusMessage}
              </span>
            ) : null}
            <IconButton
              className={SubframeUtils.twClassNames({
                hidden: state === "processing",
              })}
              variant="ghost"
              size="xsmall"
              icon={<FeatherX />}
            />
          </div>
        </div>
        <Alert
          className={SubframeUtils.twClassNames("hidden", {
            flex: state === "success",
          })}
          title={statusMessage}
          description=""
          variant="success"
          icon={<FeatherCheckCircle2 />}
        />
        <div
          className={SubframeUtils.twClassNames(
            "hidden w-full flex-col items-start gap-3",
            { flex: state === "error" }
          )}
        >
          <Alert
            title={statusMessage}
            description=""
            variant="error"
            icon={<FeatherAlertCircle />}
          />
          <div className="flex items-center gap-2 mobile:w-full mobile:flex-none mobile:flex-col">
            <Button
              variant="primary"
              size="small"
              icon={<FeatherRotateCcw />}
              badge={false}
            >
              {secondaryLabel}
            </Button>
            <Button
              variant="outline"
              size="small"
              icon={<FeatherUpload />}
              badge={false}
            >
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }
);

export const FileUpload = FileUploadRoot;
