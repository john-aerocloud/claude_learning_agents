# 2026-06-12 — engineer: directory pathspec swept a peer's in-flight WIP into a UC commit

- **Agent:** engineer (UC-S013-3, observatory)
- **Rule violated:** pathspec-isolate commits in a shared worktree (engineer brief;
  the shared-index sweep class, previously logged 3x — this is the 4th occurrence,
  a NEW VARIANT: not a shared *index* sweep but a *directory* pathspec).
- **What happened:** commit c7edf5a used the directory pathspec
  `src/app/src/components/__tests__` instead of naming my four test files. The
  UC-S015-4 engineer's in-flight `ReslicePreviewPanel.test.jsx` hunks (whose
  matching implementation was uncommitted) rode along — trunk-alone would have
  been red (test without impl).
- **Detection:** immediately, by comparing the commit's `--stat` file list
  against my staged set (20 files vs 19 expected).
- **Repair:** fc50759 — index-only restore of the file to its pre-c7edf5a blob
  (`git update-index --cacheinfo` + bare commit of the index), leaving the
  peer's worktree WIP untouched; their change re-appears as worktree-modified
  and lands with their own commit. Trunk stayed green throughout (the worktree
  suite was green; only trunk-alone was at risk).
- **Lesson / rule sharpening:** in a shared worktree, a commit pathspec must be
  a list of FILES, never a directory — a directory pathspec is a sweep with a
  smaller blast radius, not isolation. Also: `git commit -- <path>` commits the
  WORKTREE state of the path (it ignores `update-index` surgery); to commit a
  restored blob without touching the worktree, stage with `update-index
  --cacheinfo` and commit the INDEX (no pathspec).
