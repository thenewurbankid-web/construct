"use client";
// #675/#676: the shape Subframe actually exports -- the component declared on its own, exported by
// name on a separate line, many buttons that all use `onClick`, and repeated table rows.
import React from "react";
import { Button } from "../components/Button";
import { IconButton } from "../components/IconButton";
import { FeatherHome, FeatherMoreVertical, FeatherPlus, FeatherSearch, FeatherX } from "../components/Icons";

function MyCategoriesMine() {
  return (
    <div>
      <IconButton variant="outline" icon={<FeatherHome />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} />
      <IconButton variant="ghost" icon={<FeatherSearch />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} />
      <IconButton variant="ghost" icon={<FeatherX />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} />
      <Button variant="outline" icon={<FeatherPlus />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}}>
        Add category
      </Button>
      <table>
        <tbody>
          <tr><td>Steel</td><td><IconButton icon={<FeatherMoreVertical />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} /></td></tr>
          <tr><td>Logistics</td><td><IconButton icon={<FeatherMoreVertical />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} /></td></tr>
          <tr><td>IT Services</td><td><IconButton icon={<FeatherMoreVertical />} onClick={(event: React.MouseEvent<HTMLButtonElement>) => {}} /></td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default MyCategoriesMine;
