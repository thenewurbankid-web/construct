import React from "react";

type Post = { id: string; title: string; body: string; likes: number };

export default function Profile({ posts, onFollow, onTab }: { posts: Post[]; onFollow: () => void; onTab: (t: string) => void }) {
  return (
    <div className="profile">
      <div className="identity">
        <img src="/me.png" alt="avatar" className="avatar" />
        <h1>Sam Rivera</h1>
        <p className="bio">Designer and maker</p>
        <button type="button" onClick={onFollow}>Follow</button>
      </div>

      <div className="stats">
        <div className="stat">
          <strong>12</strong>
          <span>Posts</span>
        </div>
        <div className="stat">
          <strong>340</strong>
          <span>Followers</span>
        </div>
        <div className="stat">
          <strong>58</strong>
          <span>Following</span>
        </div>
      </div>

      <div className="tabs">
        <button type="button" onClick={() => onTab("posts")}>Posts</button>
        <button type="button" onClick={() => onTab("likes")}>Likes</button>
        <button type="button" onClick={() => onTab("media")}>Media</button>
      </div>

      <div className="feed">
        {posts.map((p) => (
          <div key={p.id} className="post">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
            <button type="button" onClick={() => {}}>{p.likes}</button>
          </div>
        ))}
      </div>

      <div className="suggested">
        <h2>Who to follow</h2>
        <div className="person">
          <img src="/a.png" alt="a" />
          <span>Alex</span>
          <button type="button" onClick={() => {}}>Follow</button>
        </div>
        <div className="person">
          <img src="/b.png" alt="b" />
          <span>Bo</span>
          <button type="button" onClick={() => {}}>Follow</button>
        </div>
      </div>
    </div>
  );
}
