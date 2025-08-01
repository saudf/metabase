---
title: Row and column security examples
redirect_from:
  - /docs/latest/permissions/row-and-column-security-examples
---

# Row and column security examples

{% include plans-blockquote.html feature="Row and column security" %}

[Row and column security](./row-and-column-security.md) let you:

- [Restrict **rows**](./row-and-column-security.md#row-level-security-filter-by-a-column-in-the-table).
- [Restrict **columns** (and rows)](./row-and-column-security.md#custom-row-and-column-security-use-a-saved-question-to-create-a-custom-view-of-a-table).

## Setup for all examples below

The examples below use the Sample database included with Metabase. Here's the basic setup:

1. **Block permissions for the All users group**: Hit cmd/ctrl + k to bring up the command palette and search for "Permissions". In the **Permissions** > **Data** tab. Click on the **All users** group. For the Sample database, set the All User's [View data](./data.md#view-data-permissions) permission to "Blocked".

2. **Create a group called Customers**. Hit cmd/ctrl + k and search for the People settings. [Create a group called "Customers".

3. **Create a user account for Cloyd Beer**. We'll [create a user account](../people-and-groups/managing.md#creating-an-account) for a random person from the People table in our Sample Database. Let's go with `Cloyd Beer` from the Sample database's `People` table.

4. **Add a user attribute to the account**: We'll add a user attribute to Cloyd's account. Since we want to be able to filter the data by user ID, we'll grab Cloyd's ID from the Sample database's `People` table and add the ID as a [user attribute](../people-and-groups/managing.md#adding-a-user-attribute): `user_id: 2499` (`2499` is Mr. Beer's ID in the Sample database).

![User details](images/edit-user-details.png)

5. **Add Mr. Beer to the Customers group**: See [adding people to groups](../people-and-groups/managing.md#adding-people-to-groups).

6. **Create a collection that is only viewable by Admins.**. Call it "Admin collection". We'll use this collection to store SQL questions that we use to secure tables in examples 2 and 3. See [Collection permissions](./collections.md).

## Filtering rows based on user attributes

In this example, we’ll secure our `Orders` table so that anyone in our Customers group will only be able to see rows in the Orders table where the `User ID` column matches the person's `user_id` attribute.

1. **Go to the Admin settings > Permissions > data**. Click on the "Customers" group.

2. **Set View data to Granular**. For the Sample Database, set the Customer group's [View data](./data.md#view-data-permissions) to "Granular". Setting to "Granular" will allow us to set up permissions on individual tables for the Customer group.

3. **Add row and column security to the Orders and People tables**. Here, we'll set the View data permissions on the `Orders` and `People` tables to "Row and column security". And since we want people to self-serve their data (by asking questions, creating dashboards, etc.), we'll also set their [Create queries](../permissions/data.md#create-queries-permissions) permission to "Query builder only."

![Set row and column security](./images/apply-row-and-column-security.png)

4. **Filter by a column for each table.** For each table, Metabase will ask us "How do you want to filter this table for users in this group?". In each case, we'll keep the default selection: "Filter by a column on this table." For the `Orders` table, we'll filter by the `User ID` column, which we'll set equal to the `user_id` attribute for people in the Customers group.

![Select user attribute](images/select-user-attribute.png)

For the `People` table, we'll filter by the `ID` column, which we'll set equal to that same `user_id` attribute.

5. **Save your changes**. Otherwise, all is for naught.

### Testing out the row security

To test out Mr. Beer's view of the world, we’ll open up a new incognito/private browser window and log in using Mr. Beer's account.

1. Log in as Cloyd Beer.
2. Click **Browse** > **Databases**.
3. Click on the **Orders** table.
4. Confirm that Metabase displays only the orders that Mr. Beer placed, that is, orders associated with the User ID of `2499`.

If Mr. Beer views any charts, dashboards, or even automated [X-ray explorations](../exploration-and-organization/x-rays.md) that include the secured `Orders` data, Metabase will also filter those results to show only the data Mr. Beer is permitted to see. When Mr. Beer uses the query builder to ask new questions, his results will be limited to the filtered data.

## Using a question to define a custom view of a table

You can set up row and column security so that when someone in that group queries the table, behind the scenes Metabase will instead use the question you created as the source data for their query.

You can:

- [Filter out columns](#custom-example-1-filtering-columns)
- [Filter out rows and columns](#custom-example-2-filtering-rows-and-columns)

## Custom example 1: filtering columns

In this example, we have a table called `People` that we want to trim down so that Mr. Beer and other Customers can view any row, but only some columns.

![Original People table](images/advanced-example-1-people-table.png)

1. **Create a query that limits the columns in the People table.** Using the native/SQL editor, we'll write a query that only returns the columns in that table that we _do_ want our Customers group to see, like this:

```sql
SELECT
  id AS "ID",
  name AS "Name",
  created_at AS "Created At",
  state AS "State"
FROM
  People
```

Here are the results:

![Filtering question](images/filtering-question.png)

We'll call this question "Filtered people table". Save it to the "Admins collection" you created in the setup (or any collection that only Admins have access to).

2. **Use a SQL question to create a custom view for this table**: We'll go to the Permissions section and grant this group row and column secuity to this table. This time we'll select the second option, "Use a saved question to create a custom view for this table", and select the question we just created ("Filtered people table"), like so:

![Using a question to create a custom view](images/question-modal.png)

3. **Save changes**, lest our toil matter not.

4. **Verify things are working correctly**. We can log in as Mr. Beer, and when we go to open up the `People` table, we should see that Mr. Beer can instead see the results of the filtering question.

When Mr. Beer views a chart that uses data from this secured table, Metabase will also apply the filtering. **If the chart uses any columns excluded by the secured table, the chart will NOT load for Mr. Beer.**

## Custom example 2: Filtering rows and columns

If we want to specify which columns _and_ rows people can view, we can apply row and column security to a table based on a SQL question with a variable, and associate that variable with a user attribute. To do that, we'll give our Customers group a custom view of the `Orders` table, but only let each person see rows based on their `user_id` user attribute.

1. **Create a SQL question with a variable**. We'll create a query that selects only some of the columns from the `Orders` table, and then add a `WHERE` clause with a variable that we can associate with Cloyd Beer's `user_id` user attribute.

Here's the code:

```sql
{% raw %}
SELECT
  id,
  created_at,
  product_id,
  quantity,
  total,
  user_id
FROM
  orders
WHERE
  user_id = {{user_id}}
{% endraw %}
```

Save it to the "Admins collection" you created in the setup (or any collection that only Admins have access to).

2. **Create the custom view**: Return to the **Permissions** tab. Select Cloyd Beer's Customer group, and set the **View data** access for the `Orders` table to **Row and column security**. Select **Use a saved question to create a custom view for this table**. Open up the row and column security modal and select the second option. Select the filtering question, we'll see an additional section which allows us to map the variable we defined in our question with a user attribute:

3. **Save your changes**. Or abandon all hope.

4. **Verify the permissions are working**: Now, when we log in as Mr. Beer and look at the `Orders` table, Mr. Beer will only see the columns we included in the filtering question, and the rows are filtered as specified by the variable in the question's `WHERE` clause:

![Results](images/advanced-example-2-results.png)

## Further reading

- [Setting row-level permissions](https://www.metabase.com/learn/metabase-basics/administration/permissions/data-sandboxing-row-permissions)
- [Custom views: limiting access to columns](https://www.metabase.com/learn/metabase-basics/administration/permissions/data-sandboxing-column-permissions)
- [Configuring permissions for embedding](../permissions/embedding.md)
