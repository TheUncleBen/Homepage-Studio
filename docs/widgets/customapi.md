# Custom API

Integration · type `customapi` · [Homepage documentation](https://gethomepage.dev/widgets/services/customapi/)

[All widgets](README.md)

## What it needs

_(Find the Custom API information widget [here](https://gethomepage.dev/widgets/info/customapi/))_

This widget can show information from custom self-hosted or third party API.

Fields need to be defined in the `mappings` section YAML object to correlate with the value in the APIs JSON object. Final field definition needs to be the key with the desired value information.

Supported formats for the values are `text`, `number`, `float`, `percent`, `duration`, `bytes`, `bitrate`, `size`, `date` and `relativeDate`.

The `dateStyle` and `timeStyle` options of the `date` format are passed directly to [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat) and the `style` and `numeric` options of `relativeDate` are passed to [Intl.RelativeTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat/RelativeTimeFormat).

The `duration` format expects the duration to be specified in seconds. The `scale` transformation tool can be used if a conversion is required.

The `size` format will return the length of the array or string, or the number of keys in an object. This is then formatted as `number`.

#### Example

For the following JSON object from the API:

```
{
  "id": 1,
  "name": "Rick Sanchez",
  "status": "Alive",
  "species": "Human",
  "gender": "Male",
  "origin": {
    "name": "Earth (C-137)"
  },
  "locations": [
    {
      "name": "Earth (C-137)"
    },
    {
      "name": "Citadel of Ricks"
    }
  ]
}
```

#### Display Options

The widget supports different display modes that can be set using the `display` property.

#### Block View (Default)

The default display mode is `block`, which shows fields in a block format.

> **Note**
>
> The Custom API widget does not currently support [block highlighting](https://gethomepage.dev/configs/services/#block-highlighting) in any display mode.

#### List View

You can change the default block view to a list view by setting the `display` option to `list`.

The list view can optionally display an additional field next to the primary field.

`additionalField`: Similar to `field`, but only used in list view. Displays additional information for the mapping object on the right.

`field`: Defined the same way as other custom api widget fields.

`color`: Allowed options: `"theme", "adaptive", "black", "white"`. The option `adaptive` will apply a color using the value of the `additionalField`, green for positive numbers, red for negative numbers.

#### Dynamic List View

This configuration would work with an API that returns a response like:

```
{
  "data": [
    { "id": "server1", "name": "Server 1", "ip_address": "192.168.0.1" },
    { "id": "server2", "name": "Server 2", "ip_address": "192.168.0.2" }
  ]
}
```

The widget would display a list with two items:

- "Server 1" on the left and "192.168.0.1" on the right, clickable to "https://example.com/server/server1"
- "Server 2" on the left and "192.168.0.2" on the right, clickable to "https://example.com/server/server2"

#### Custom Request Body

Pass custom request body using the `requestBody` option in either a string or object format. Objects will automatically be converted to a JSON string.

Both formats result in `{"foo":"bar"}` being sent as the request body. Don't forget to set your `Content-Type` headers!

## Settings

What the widget dialog shows. Anything else the widget accepts goes in the dialog's YAML view.

| Setting | YAML key | Type | Notes |
| --- | --- | --- | --- |
| Service URL | `url` | Text | Example: `http://custom.api.host.or.ip:port/path/to/exact/api/endpoint`. |
| Refresh interval (ms) | `refreshInterval` | Number | Example: `10000`. |
| Username | `username` | Text | Example: `username`. |
| Password | `password` | Text | Secret: hidden while you type. Prefer a `{{HOMEPAGE_VAR_…}}` or `{{HOMEPAGE_FILE_…}}` reference. |
| Method | `method` | Text | Example: `GET`. |
| Value mappings | `mappings` | List or Settings (name: value) |  |
| Display | `display` | Text | Example: `dynamic-list`. |
| Request headers | `headers` | Settings (name: value) |  |
| Request Body | `requestBody` | Text or Settings (name: value) |  |

## Examples

From Homepage's documentation. Values are examples, not defaults.

```yaml
widget:
  type: customapi
  url: http://custom.api.host.or.ip:port/path/to/exact/api/endpoint
  refreshInterval: 10000 # optional - in milliseconds, defaults to 10s
  username: username # auth - optional
  password: password # auth - optional
  method: GET # optional, e.g. POST
  headers: # optional, must be object, see below
  requestBody: # optional, can be string or object, see below
  display: # optional, default to block, see below
  mappings:
    - field: key
      label: Field 1
      format: text # optional - defaults to text
    - field: path.to.key2
      format: number # optional - defaults to text
      label: Field 2
    - field: path.to.another.key3
      label: Field 3
      format: percent # optional - defaults to text
    - field: key
      label: Field 4
      format: date # optional - defaults to text
      locale: nl # optional
      dateStyle: long # optional - defaults to "long". Allowed values: `["full", "long", "medium", "short"]`.
      timeStyle: medium # optional - Allowed values: `["full", "long", "medium", "short"]`.
    - field: key
      label: Field 5
      format: relativeDate # optional - defaults to text
      locale: nl # optional
      style: short # optional - defaults to "long". Allowed values: `["long", "short", "narrow"]`.
      numeric: auto # optional - defaults to "always". Allowed values `["always", "auto"]`.
    - field: key
      label: Field 6
      format: text
      additionalField: # optional
        field: hourly.time.key
        color: theme # optional - defaults to "". Allowed values: `["theme", "adaptive", "black", "white"]`.
        format: date # optional
    - field: key
      label: Number of things in array
      format: size
    # This (no field) will take the root of the API response, e.g. when APIs return an array:
    - label: Number of items
      format: size
```

```yaml
widget:
  type: customapi
  url: https://example.com/api/servers
  display: dynamic-list
  mappings:
    items: data # optional, the path to the array in the API response. Omit this option if the array is at the root level
    name: id # required, field in each item to use as the item name (left side)
    label: ip_address # required, field in each item to use as the item label (right side)
    limit: 5 # optional, limit the number of items to display
    format: text # optional - format of the label field
    target: https://example.com/server/{id} # optional, makes items clickable with template support
```

## Source

- [docs/widgets/services/customapi.md](https://github.com/gethomepage/homepage/blob/51cc1684f9f34a7877ed462b8f94c9cc687b4dde/docs/widgets/services/customapi.md)

<!-- Generated by scripts/build-widget-docs.mjs from public/catalog.json. Do not edit by hand. -->
