#!/usr/bin/env bash

extract_file() {
    local file="$1"

    if [ -f "$file" ]; then
        case "$file" in
        *.ark|*.arc) arc x "$file" ;;
        *.arj) arj e "$file" ;;
        *.cbt) tar xvf "$file" ;;
        *.cso) ciso 0 "$file" "$file.iso" && extract_file "$file.iso" && rm -f "$file" ;;
        *.tar.bz2) tar xvjf "$file" ;;
        *.tar.gz) tar xvzf "$file" ;;
        *.tar.lzma) tar --lzma -xvf "$file" ;;
        *.tar.xz) tar -xf "$file" ;;
        *.tar.lz) lzip -d "$file" ;;
        *.tar.7z) 7z x -so "$file" | tar -xf - ;;
        *.tar.Z) zcat "$file" | tar -xvf - ;;
        *.jar) jar xf "$file" ;;
        *.bz2) bunzip2 "$file" ;;
        *.rar|*.cbr) unrar x -ad "$file" ;;
        *.gz) gunzip "$file" ;;
        *.cab|*.exe) cabextract "$file" ;;
        *.cpio) cpio -id < "$file" ;;
        *.cba|*.ace) unace x "$file" ;;
        *.tar) tar xvf "$file" ;;
        *.tbz2) tar xvjf "$file" ;;
        *.tgz) tar xvzf "$file" ;;
        *.lz4) lz4 -d "$file" ;;
        *.xz) unxz "$file" ;;
        *.zip|*.epub|*.cbz) unzip "$file" ;;
        *.7z|*.z|*.apk|*.deb|*.dmg|*.lzh|*.msi|*.pkg|*.rpm|*.udf|*.wim|*.xar) 7z x "$file";;
        *.zst) zstd -dc "$file" ;;
        *.zpaq) zpaq x "$file" ;;
        *.zoo) zoo -extract "$file" ;;
        *) echo "File format not supported: '$file'" ;;
        esac
    else
        echo "'$file' is not a valid file!"
    fi
}

main() {
    if [ $# -eq 0 ]; then
        echo "No arguments provided"
        echo "Usage: extract <file1> <file2> ..."
        exit 1
    fi

    while [ $# -gt 0 ]; do
        extract_file "$1"
        shift
    done
}

# alias for extract_file 
alias extract=extract_file

main "$@"