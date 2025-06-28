#!/usr/bin/env bash

# Script Name: extract.sh
# Description: Extracts files based on their extension.
# Usage: extract.sh [archive file] [optional: output directory]

command_exists() {
    command -v "$1" >/dev/null 2>&1 || { echo >&2 "I require $1 but it's not installed. Aborting."; exit 1; }
}

extract_file() {
    local file="$1"
    local output_dir="${2:-.}"

    if [ -f "$file" ]; then
        case "$file" in
        *.ark|*.arc) command_exists "arc" && arc x "$file" -C "$output_dir" ;;
        *.arj) command_exists "arj" && arj e "$file" -C "$output_dir" ;;
        *.cbt) command_exists "tar" && tar xvf "$file" -C "$output_dir" ;;
        *.cso) command_exists "ciso" && ciso 0 "$file" "$file.iso" && extract_file "$file.iso" "$output_dir" && rm -f "$file" ;;
        *.tar.bz2) command_exists "tar" && tar xvjf "$file" -C "$output_dir" ;;
        *.tar.gz) command_exists "tar" && tar xvzf "$file" -C "$output_dir" ;;
        *.tar.lzma) command_exists "tar" && tar --lzma -xvf "$file" -C "$output_dir" ;;
        *.tar.xz) command_exists "tar" && tar -xf "$file" -C "$output_dir" ;;
        *.tar.lz) command_exists "lzip" && lzip -d "$file" -C "$output_dir" ;;
        *.tar.7z) command_exists "7z" && command_exists "tar" && 7z x -so "$file" | tar -xf - -C "$output_dir" ;;
        *.tar.Z) command_exists "zcat" && command_exists "tar" && zcat "$file" | tar -xvf - -C "$output_dir" ;;
        *.jar) command_exists "jar" && jar xf "$file" -C "$output_dir" ;;
        *.bz2) command_exists "bunzip2" && bunzip2 "$file" -C "$output_dir" ;;
        *.rar|*.cbr) command_exists "unrar" && unrar x -ad "$file" "$output_dir" ;;
        *.gz) command_exists "gunzip" && gunzip "$file" -c > "$output_dir" ;;
        *.cab|*.exe) command_exists "cabextract" && cabextract -d "$output_dir" "$file" ;;
        *.cpio) command_exists "cpio" && cpio -id < "$file" -C "$output_dir" ;;
        *.cba|*.ace) command_exists "unace" && unace x "$file" "$output_dir" ;;
        *.tar) command_exists "tar" && tar xvf "$file" -C "$output_dir" ;;
        *.tbz2) command_exists "tar" && tar xvjf "$file" -C "$output_dir" ;;
        *.tgz) command_exists "tar" && tar xvzf "$file" -C "$output_dir" ;;
        *.lz4) command_exists "lz4" && lz4 -d "$file" -C "$output_dir" ;;
        *.xz) command_exists "unxz" && unxz "$file" -C "$output_dir" ;;
        *.zip|*.epub|*.cbz) command_exists "unzip" && unzip "$file" -d "$output_dir" ;;
        *.7z|*.z|*.apk|*.deb|*.dmg|*.lzh|*.msi|*.pkg|*.rpm|*.udf|*.wim|*.xar) command_exists "7z" && 7z x "$file" -o"$output_dir" ;;
        *.zst) command_exists "zstd" && zstd -dc "$file" -C "$output_dir" ;;
        *.zpaq) command_exists "zpaq" && zpaq x "$file" "$output_dir" ;;
        *.zoo) command_exists "zoo" && zoo -extract "$file" "$output_dir" ;;
        *) echo "File format not supported: '$file'" ;;
        esac
    else
        echo "'$file' is not a valid file!"
    fi
}

main() {
    if [ $# -lt 1 ] || [ $# -gt 2 ]; then
        echo "Usage: extract.sh [archive file] [optional: output directory]"
        exit 1
    fi

    file="$1"
    output_dir="${2:-.}"

    if ! [ -f "$file" ]; then
        echo "File $file does not exist."
        exit 1
    fi

    if ! [ -d "$output_dir" ]; then
        mkdir -p "$output_dir" || { echo "Failed to create output directory $output_dir"; exit 1; }
        echo "Created output directory $output_dir"
    fi

    extract_file "$file" "$output_dir"
}

main "$@"