export type DisplayLabels = Record<string, string>

export function displayValueTemplate(labels: DisplayLabels) {
    return `{{ ${JSON.stringify(labels)}.get(value, value) }}`
}

export function commandValueTemplate(labels: DisplayLabels) {
    const internalValues = Object.fromEntries(Object.entries(labels).map(([internal, display]) => [display, internal]))
    return `{{ ${JSON.stringify(internalValues)}.get(value, value) }}`
}

export function displayOptions(values: string[], labels: DisplayLabels) {
    return [...new Set(values.map((value) => labels[value] ?? value))]
}
