#!/bin/bash
set -euo pipefail

SOURCE_REPO=""
TARGET_REPO=""
PACKAGES="server,client,protocol"

usage() {
  cat <<'EOF'
Usage:
  ensure-node-modules.sh --source-repo <path> --target-repo <path> [options]

Options:
  --source-repo <path>   Reference repo used for lockfile-compatible symlink reuse
  --target-repo <path>   Engine repo/worktree whose dependencies should be prepared
  --packages <list>      Comma-separated package dirs to prepare (default: server,client,protocol)
  -h, --help             Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-repo)
      SOURCE_REPO="$(cd "$2" && pwd)"
      shift 2
      ;;
    --target-repo)
      TARGET_REPO="$(cd "$2" && pwd)"
      shift 2
      ;;
    --packages)
      PACKAGES="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SOURCE_REPO" || -z "$TARGET_REPO" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -d "$SOURCE_REPO" || ! -d "$TARGET_REPO" ]]; then
  echo "Error: source and target repos must both exist" >&2
  exit 1
fi

ensure_package_deps() {
  local package_rel="$1"
  local source_dir="$SOURCE_REPO/$package_rel"
  local target_dir="$TARGET_REPO/$package_rel"
  local source_manifest="$source_dir/package.json"
  local target_manifest="$target_dir/package.json"
  local source_lock="$source_dir/package-lock.json"
  local target_lock="$target_dir/package-lock.json"
  local target_node_modules="$target_dir/node_modules"
  local can_reuse="false"

  if [[ ! -f "$target_manifest" ]]; then
    return
  fi

  if [[ -d "$source_dir/node_modules" ]]; then
    if [[ -f "$source_lock" && -f "$target_lock" ]] && cmp -s "$source_lock" "$target_lock"; then
      can_reuse="true"
    elif [[ ! -f "$source_lock" && ! -f "$target_lock" && -f "$source_manifest" ]] && cmp -s "$source_manifest" "$target_manifest"; then
      can_reuse="true"
    fi
  fi

  if [[ -L "$target_node_modules" ]]; then
    local target_link
    target_link="$(readlink "$target_node_modules")"

    if [[ -n "$target_link" && "$target_link" == "$source_dir/node_modules" && "$can_reuse" == "true" ]]; then
      return
    fi

    rm -f "$target_node_modules"
  fi

  if [[ -d "$target_node_modules" ]]; then
    return
  fi

  if [[ "$can_reuse" == "true" ]]; then
    mkdir -p "$target_dir"
    ln -s "$source_dir/node_modules" "$target_node_modules"
    echo "Reused $package_rel/node_modules from $SOURCE_REPO"
    return
  fi

  echo "Installing dependencies in $target_dir"

  if [[ -f "$target_lock" ]]; then
    (
      cd "$target_dir"
      npm ci --no-audit --no-fund
    )
  else
    (
      cd "$target_dir"
      npm install --no-audit --no-fund
    )
  fi
}

IFS=',' read -r -a PACKAGE_ARRAY <<< "$PACKAGES"

for package_rel in "${PACKAGE_ARRAY[@]}"; do
  package_rel="${package_rel// /}"
  [[ -z "$package_rel" ]] && continue
  ensure_package_deps "$package_rel"
done
